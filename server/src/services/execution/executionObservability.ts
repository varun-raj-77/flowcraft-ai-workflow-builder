import mongoose from 'mongoose';
import { Workflow } from '../../models/Workflow.model';
import { ExecutionRun } from '../../models/ExecutionRun.model';
import { AppError } from '../../middleware/errorHandler.middleware';
import { EXECUTION_INTERRUPTED_MESSAGE } from './executionRecovery';

export const EXECUTION_DIAGNOSTICS_LIMIT = 50;
export type RetryReadiness = 'ready' | 'not_ready' | 'unavailable';
export interface HistoryIndexReadiness {
  unfiltered: RetryReadiness;
  filtered: RetryReadiness;
}
type HistoryIndexCatalogEntry = {
  key?: Record<string, unknown>;
  partialFilterExpression?: unknown;
  sparse?: boolean;
  hidden?: boolean;
  collation?: unknown;
};
/** Recommended shapes only; never creates, drops or hints a production index. */
export function assessHistoryIndexReadiness(
  indexes: readonly HistoryIndexCatalogEntry[],
): HistoryIndexReadiness {
  const matches = (expected: Record<string, number>): boolean => indexes.some((index) => {
    const key = index.key;
    return !!key
      && Object.keys(key).length === Object.keys(expected).length
      && Object.entries(expected).every(([field, direction]) => key[field] === direction)
      && index.partialFilterExpression === undefined && index.sparse !== true
      && index.hidden !== true && index.collation === undefined;
  });
  return {
    unfiltered: matches({ workflowId: 1, userId: 1, createdAt: -1, _id: -1 }) ? 'ready' : 'not_ready',
    filtered: matches({ workflowId: 1, userId: 1, status: 1, createdAt: -1, _id: -1 }) ? 'ready' : 'not_ready',
  };
}

/** Require the *exact* M10 single-field unique partial index. No schema writes. */
export function isRetryIndexReady(indexes: readonly {
  unique?: boolean;
  key?: Record<string, unknown>;
  partialFilterExpression?: { retryOfRunId?: { $type?: unknown } };
}[]): boolean {
  return indexes.some((index) =>
    index.unique === true
    && index.key?.retryOfRunId === 1
    && Object.keys(index.key).length === 1
    && index.partialFilterExpression?.retryOfRunId?.$type === 'objectId');
}

/** One read-only index-catalog lookup supplies both readiness summaries. */
async function readExecutionIndexReadiness(): Promise<{
  retryReadiness: RetryReadiness;
  historyIndexReadiness: HistoryIndexReadiness;
}> {
  try {
    const indexes = await ExecutionRun.collection.indexes();
    return {
      retryReadiness: isRetryIndexReady(indexes) ? 'ready' : 'not_ready',
      historyIndexReadiness: assessHistoryIndexReadiness(indexes),
    };
  } catch {
    // Do not expose collection/index names, database errors or connection strings.
    return {
      retryReadiness: 'unavailable',
      historyIndexReadiness: { unfiltered: 'unavailable', filtered: 'unavailable' },
    };
  }
}

/** Existing M10 retry safety guard remains unchanged in behavior. */
export async function checkRetryReadiness(): Promise<RetryReadiness> {
  return (await readExecutionIndexReadiness()).retryReadiness;
}

type RunStatus = 'running' | 'completed' | 'failed' | 'cancelled';
export interface DiagnosticRow {
  status: RunStatus;
  error?: string;
  retryOfRunId?: unknown;
  startedAt?: Date;
  completedAt?: Date;
  leaseExpiresAt?: Date;
}
export interface ExecutionDiagnostics {
  scannedAt: string;
  sampleSize: number;
  sampleLimit: number;
  counts: {
    running: number;
    completed: number;
    failed: number;
    cancelled: number;
    interrupted: number;
    otherFailures: number;
    retriedAttempts: number;
    expiredRunningLeases: number;
  };
  averageTerminalDurationMs: number | null;
  retryReadiness: RetryReadiness;
  historyIndexReadiness: HistoryIndexReadiness;
}

/**
 * Pure bounded aggregation. No run IDs, labels, errors, source, secret, lease
 * tokens or customer payloads appear in the returned summary.
 */
export function summarizeExecutionRows(
  rows: readonly DiagnosticRow[],
  now = new Date(),
): Omit<ExecutionDiagnostics, 'retryReadiness'> {
  const counts = {
    running: 0, completed: 0, failed: 0, cancelled: 0,
    interrupted: 0, otherFailures: 0, retriedAttempts: 0,
    expiredRunningLeases: 0,
  };
  let terminalMs = 0;
  let terminalCount = 0;
  for (const row of rows) {
    if (!(row.status in { running: 1, completed: 1, failed: 1, cancelled: 1 })) continue;
    counts[row.status] += 1;
    if (row.status === 'failed') {
      if (row.error === EXECUTION_INTERRUPTED_MESSAGE) counts.interrupted += 1;
      else counts.otherFailures += 1;
    }
    if (row.retryOfRunId) counts.retriedAttempts += 1;
    if (row.status === 'running' && row.leaseExpiresAt instanceof Date
      && Number.isFinite(row.leaseExpiresAt.getTime()) && row.leaseExpiresAt <= now) {
      counts.expiredRunningLeases += 1;
    }
    if (row.status !== 'running' && row.startedAt instanceof Date && row.completedAt instanceof Date) {
      const duration = row.completedAt.getTime() - row.startedAt.getTime();
      if (Number.isFinite(duration) && duration >= 0) {
        terminalMs += duration;
        terminalCount += 1;
      }
    }
  }
  return {
    scannedAt: now.toISOString(),
    sampleSize: rows.length,
    sampleLimit: EXECUTION_DIAGNOSTICS_LIMIT,
    counts,
    averageTerminalDurationMs: terminalCount ? Math.round(terminalMs / terminalCount) : null,
  };
}

/** Owner must be confirmed before *any* execution or index-catalog read. */
export async function getOwnedExecutionDiagnostics(
  workflowId: string,
  userId: string,
  now = new Date(),
): Promise<ExecutionDiagnostics> {
  if (!mongoose.isValidObjectId(workflowId)) {
    throw new AppError(404, 'WORKFLOW_NOT_FOUND', 'Workflow not found');
  }
  const owned = await Workflow.exists({ _id: workflowId, userId });
  if (!owned) {
    throw new AppError(404, 'WORKFLOW_NOT_FOUND', 'Workflow not found');
  }
  const rows = await ExecutionRun.find({ workflowId, userId })
    .sort({ createdAt: -1 })
    .limit(EXECUTION_DIAGNOSTICS_LIMIT)
    .select('status error retryOfRunId startedAt completedAt leaseExpiresAt')
    .lean() as unknown as DiagnosticRow[];
  return { ...summarizeExecutionRows(rows, now), ...await readExecutionIndexReadiness() };
}

/** Fixed vocabulary only: NEVER pass user-created text into an operational event. */
export function logExecutionOutcome(
  status: 'completed' | 'failed',
  cause: 'node_failure' | 'preflight_failure' | 'engine_failure' | 'normal_completion',
): void {
  console.info(JSON.stringify({ event: 'execution_terminal', status, cause }));
}
