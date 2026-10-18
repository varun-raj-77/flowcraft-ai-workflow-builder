import mongoose from 'mongoose';
import { AppError } from '../../middleware/errorHandler.middleware';
import { Workflow } from '../../models/Workflow.model';
import { ExecutionRun, type IExecutionRun } from '../../models/ExecutionRun.model';

export const EXECUTION_HISTORY_PAGE_SIZE = 20;
const MAX_CURSOR_LENGTH = 160;

type HistoryRow = IExecutionRun & { _id: mongoose.Types.ObjectId };
export interface ExecutionHistoryPage {
  runs: HistoryRow[];
  nextCursor: string | null;
}

function invalidCursor(): never {
  throw new AppError(400, 'INVALID_HISTORY_CURSOR', 'Invalid execution history cursor.');
}

export function parseHistoryLimit(input: unknown): number {
  if (input === undefined) return EXECUTION_HISTORY_PAGE_SIZE;
  if (typeof input !== 'string' || !/^(?:[1-9]|1\d|20)$/.test(input)) {
    throw new AppError(400, 'INVALID_HISTORY_LIMIT', 'History page limit must be between 1 and 20.');
  }
  return Number(input);
}

/** Stable keyset ordered by (createdAt DESC, _id DESC). No tenant data or payloads. */
export function encodeHistoryCursor(row: Pick<HistoryRow, '_id' | 'createdAt'>): string {
  return Buffer.from(JSON.stringify([1, row.createdAt.getTime(), row._id.toString()]), 'utf8')
    .toString('base64url');
}

export function parseHistoryCursor(input: unknown): { createdAt: Date; id: mongoose.Types.ObjectId } | null {
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
  if (!Array.isArray(payload) || payload.length !== 3 || payload[0] !== 1
    || typeof payload[1] !== 'number' || !Number.isSafeInteger(payload[1])
    || payload[1] < 0 || payload[1] > 8_640_000_000_000_000
    || typeof payload[2] !== 'string' || !/^[a-f0-9]{24}$/.test(payload[2])) {
    invalidCursor();
  }
  const createdAt = new Date(payload[1]);
  if (!Number.isFinite(createdAt.getTime())) invalidCursor();
  return { createdAt, id: new mongoose.Types.ObjectId(payload[2]) };
}

/**
 * Read-only, tenant-verified keyset page. An extra row determines the next
 * cursor without an expensive total-count query. The filter includes userId
 * even after verifying ownership, so a foreign cursor can never reveal runs.
 */
export async function getOwnedExecutionHistoryPage(
  workflowId: string,
  userId: string,
  options: { limit?: unknown; cursor?: unknown } = {},
): Promise<ExecutionHistoryPage> {
  const limit = parseHistoryLimit(options.limit);
  const cursor = parseHistoryCursor(options.cursor);
  if (!mongoose.isValidObjectId(workflowId)) {
    throw new AppError(404, 'WORKFLOW_NOT_FOUND', 'Workflow not found');
  }
  const owned = await Workflow.exists({ _id: workflowId, userId });
  if (!owned) throw new AppError(404, 'WORKFLOW_NOT_FOUND', 'Workflow not found');

  const before = cursor ? { $or: [
    { createdAt: { $lt: cursor.createdAt } },
    { createdAt: cursor.createdAt, _id: { $lt: cursor.id } },
  ] } : {};
  const rows = await ExecutionRun.find({ workflowId, userId, ...before })
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1)
    .select('-leaseOwner -leaseHeartbeatAt -leaseExpiresAt')
    .lean() as unknown as HistoryRow[];
  const runs = rows.slice(0, limit);
  return {
    runs,
    nextCursor: rows.length > limit && runs.length
      ? encodeHistoryCursor(runs[runs.length - 1])
      : null,
  };
}
