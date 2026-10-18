import mongoose from 'mongoose';
import { Workflow } from '../../models/Workflow.model';
import { ExecutionRun } from '../../models/ExecutionRun.model';
import { AppError } from '../../middleware/errorHandler.middleware';
import { EXECUTION_INTERRUPTED_MESSAGE } from './executionRecovery';

export const EXECUTION_DIAGNOSTICS_LIMIT = 50;
export type RetryReadiness = 'ready' | 'not_ready' | 'unavailable';

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

/** Fail closed on missing catalog access; never reveal names or DB exceptions. */
export async function checkRetryReadiness(): Promise<RetryReadiness> {
  try {
    return isRetryIndexReady(await ExecutionRun.collection.indexes())
      ? 'ready' : 'not_ready';
  } catch {
    return 'unavailable';
  }
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
  return { ...summarizeExecutionRows(rows, now), retryReadiness: await checkRetryReadiness() };
}

/** Fixed vocabulary only: NEVER pass user-created text into an operational event. */
export function logExecutionOutcome(
  status: 'completed' | 'failed',
  cause: 'node_failure' | 'preflight_failure' | 'engine_failure' | 'normal_completion',
): void {
  console.info(JSON.stringify({ event: 'execution_terminal', status, cause }));
}
