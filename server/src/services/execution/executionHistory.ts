import mongoose from 'mongoose';
import { AppError } from '../../middleware/errorHandler.middleware';
import { Workflow } from '../../models/Workflow.model';
import { ExecutionRun, type IExecutionRun } from '../../models/ExecutionRun.model';

export const EXECUTION_HISTORY_PAGE_SIZE = 20;
/** Bound MongoDB work on old/high-volume histories; not a client-side HTTP timeout. */
export const EXECUTION_HISTORY_QUERY_TIMEOUT_MS = 4_000;
/** Preserve the existing history contract without accidentally selecting future private fields. */
export const EXECUTION_HISTORY_PUBLIC_FIELDS =
  '_id workflowId retryOfRunId workflowRevisionId workflowRevision definitionHash ' +
  'userId status startedAt completedAt triggerType error stepLogs executionOrder createdAt updatedAt';
/** Detail-free opt-in projection. Step metadata supports counts and pinned comparisons;
 * input/output/error/diagnostic payloads remain on the owner-checked single-run route.
 * Do not project the entire stepLogs subdocument.
 */
export const EXECUTION_HISTORY_SUMMARY_FIELDS =
  '_id workflowId retryOfRunId workflowRevisionId workflowRevision definitionHash ' +
  'userId status startedAt completedAt triggerType executionOrder createdAt updatedAt ' +
  'stepLogs.nodeId stepLogs.nodeType stepLogs.nodeLabel stepLogs.status stepLogs.durationMs';
const MAX_CURSOR_LENGTH = 160;
export type ExecutionHistoryFilter = 'all' | 'running' | 'completed' | 'failed' | 'cancelled';
const STATUSES = new Set<ExecutionHistoryFilter>(['all', 'running', 'completed', 'failed', 'cancelled']);

type HistoryRow = IExecutionRun & { _id: mongoose.Types.ObjectId };
export interface ExecutionHistoryPage {
  runs: HistoryRow[];
  nextCursor: string | null;
}

function invalidCursor(): never {
  throw new AppError(400, 'INVALID_HISTORY_CURSOR', 'Invalid execution history cursor.');
}

export type ExecutionHistoryView = 'full' | 'summary';
/** Reject untrusted query objects/arrays and preserve the legacy default full response. */
export function parseHistoryView(input: unknown): ExecutionHistoryView {
  if (input === undefined) return 'full';
  if (input === 'full' || input === 'summary') return input;
  throw new AppError(400, 'INVALID_HISTORY_VIEW', 'Invalid execution history view.');
}

export function parseHistoryLimit(input: unknown): number {
  if (input === undefined) return EXECUTION_HISTORY_PAGE_SIZE;
  if (typeof input !== 'string' || !/^(?:[1-9]|1\d|20)$/.test(input)) {
    throw new AppError(400, 'INVALID_HISTORY_LIMIT', 'History page limit must be between 1 and 20.');
  }
  return Number(input);
}

/** Strict enum: no Mongo operators, arrays or other query parameters. */
export function parseHistoryStatus(input: unknown): ExecutionHistoryFilter {
  if (input === undefined) return 'all';
  if (typeof input !== 'string' || !STATUSES.has(input as ExecutionHistoryFilter)) {
    throw new AppError(400, 'INVALID_HISTORY_STATUS', 'Invalid execution history status.');
  }
  return input as ExecutionHistoryFilter;
}

/** Stable keyset ordered by (createdAt DESC, _id DESC). No tenant data or payloads.
 * Unfiltered pages preserve M14 version 1 cursors. Filtered pages are bound to
 * their status using version 2; a cursor cannot cross status filters.
 */
export function encodeHistoryCursor(
  row: Pick<HistoryRow, '_id' | 'createdAt'>,
  status: ExecutionHistoryFilter = 'all',
): string {
  const values = status === 'all'
    ? [1, row.createdAt.getTime(), row._id.toString()]
    : [2, status, row.createdAt.getTime(), row._id.toString()];
  return Buffer.from(JSON.stringify(values), 'utf8').toString('base64url');
}

export function parseHistoryCursor(
  input: unknown,
  status: ExecutionHistoryFilter = 'all',
): { createdAt: Date; id: mongoose.Types.ObjectId } | null {
  if (input === undefined) return null;
  if (typeof input !== 'string' || !input || input.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(input)) {
    invalidCursor();
  }
  let payload: unknown;
  try {
    const decoded = Buffer.from(input, 'base64url');
    if (decoded.toString('base64url') !== input) invalidCursor();
    payload = JSON.parse(decoded.toString('utf8'));
  } catch {
    invalidCursor();
  }
  if (!Array.isArray(payload)) invalidCursor();
  // Never allow a V1 unfiltered page token to be used with filtered paging.
  const isV1 = payload.length === 3 && payload[0] === 1 && status === 'all';
  const isV2 = payload.length === 4 && payload[0] === 2
    && status !== 'all' && payload[1] === status;
  if (!isV1 && !isV2) invalidCursor();
  const timestamp = payload[isV1 ? 1 : 2];
  const objectId = payload[isV1 ? 2 : 3];
  if (typeof timestamp !== 'number' || !Number.isSafeInteger(timestamp)
    || timestamp < 0 || timestamp > 8_640_000_000_000_000
    || typeof objectId !== 'string' || !/^[a-f0-9]{24}$/.test(objectId)) {
    invalidCursor();
  }
  const createdAt = new Date(timestamp);
  if (!Number.isFinite(createdAt.getTime())) invalidCursor();
  return { createdAt, id: new mongoose.Types.ObjectId(objectId) };
}

/**
 * Read-only, tenant-verified keyset page. An extra row determines the next
 * cursor without an expensive total-count query. The filter includes userId
 * even after verifying ownership, so a foreign cursor can never reveal runs.
 */
export async function getOwnedExecutionHistoryPage(
  workflowId: string,
  userId: string,
  options: { limit?: unknown; cursor?: unknown; status?: unknown; view?: unknown } = {},
): Promise<ExecutionHistoryPage> {
  const limit = parseHistoryLimit(options.limit);
  const status = parseHistoryStatus(options.status);
  const view = parseHistoryView(options.view);
  const cursor = parseHistoryCursor(options.cursor, status);
  if (!mongoose.isValidObjectId(workflowId)) {
    throw new AppError(404, 'WORKFLOW_NOT_FOUND', 'Workflow not found');
  }
  const owned = await Workflow.exists({ _id: workflowId, userId });
  if (!owned) throw new AppError(404, 'WORKFLOW_NOT_FOUND', 'Workflow not found');

  const before = cursor ? { $or: [
    { createdAt: { $lt: cursor.createdAt } },
    { createdAt: cursor.createdAt, _id: { $lt: cursor.id } },
  ] } : {};
  let rows: HistoryRow[];
  try {
    rows = await ExecutionRun.find({ workflowId, userId, ...(status === 'all' ? {} : { status }), ...before })
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .select(view === 'summary' ? EXECUTION_HISTORY_SUMMARY_FIELDS : EXECUTION_HISTORY_PUBLIC_FIELDS)
      .maxTimeMS(EXECUTION_HISTORY_QUERY_TIMEOUT_MS)
      .lean() as unknown as HistoryRow[];
  } catch (error) {
    // MongoDB code 50 means the server aborted an expensive query. Never echo
    // its error details or retry a query automatically under heavy load.
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 50) {
      throw new AppError(503, 'HISTORY_QUERY_TIMEOUT',
        'Execution history is temporarily busy. Please retry.');
    }
    throw error;
  }
  const runs = rows.slice(0, limit);
  return {
    runs,
    nextCursor: rows.length > limit && runs.length
      ? encodeHistoryCursor(runs[runs.length - 1], status)
      : null,
  };
}
