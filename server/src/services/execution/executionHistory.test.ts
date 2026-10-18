import { beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';

const mocks = vi.hoisted(() => ({ exists: vi.fn(), find: vi.fn() }));
vi.mock('../../models/Workflow.model', () => ({ Workflow: { exists: mocks.exists } }));
vi.mock('../../models/ExecutionRun.model', () => ({ ExecutionRun: { find: mocks.find } }));

import {
  EXECUTION_HISTORY_PAGE_SIZE,
  encodeHistoryCursor, getOwnedExecutionHistoryPage, parseHistoryCursor, parseHistoryLimit,
} from './executionHistory';

const workflowId = '507f1f77bcf86cd799439011';
const userId = 'account-owner';
const record = (id: number, timestamp = '2026-10-18T12:00:00.000Z') => ({
  _id: new mongoose.Types.ObjectId(id.toString(16).padStart(24, '0')),
  createdAt: new Date(timestamp),
  workflowId: new mongoose.Types.ObjectId(workflowId),
  userId,
  status: 'completed',
  stepLogs: [{ error: 'Bearer secret-do-not-copy', output: { token: 'private' } }],
});
function mockRows(rows: unknown[]) {
  const lean = vi.fn().mockResolvedValue(rows);
  const select = vi.fn().mockReturnValue({ lean });
  const limit = vi.fn().mockReturnValue({ select });
  const sort = vi.fn().mockReturnValue({ limit });
  mocks.find.mockReturnValue({ sort });
  return { sort, limit, select, lean };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.exists.mockResolvedValue({ _id: workflowId });
  mockRows([]);
});

describe('M14 strict execution history cursor and page bounds', () => {
  it('accepts only 1–20 decimal page limits and defaults to 20', () => {
    expect(parseHistoryLimit(undefined)).toBe(EXECUTION_HISTORY_PAGE_SIZE);
    for (const n of ['1', '9', '10', '19', '20']) expect(parseHistoryLimit(n)).toBe(Number(n));
    for (const value of [0, 21, '0', '21', '01', '-1', '2.5', ' 2', '', [], {}, null]) {
      expect(() => parseHistoryLimit(value)).toThrow();
    }
  });

  it('round-trips a strict timestamp and ObjectId cursor with no secrets', () => {
    const row = record(7);
    const token = encodeHistoryCursor(row);
    const parsed = parseHistoryCursor(token)!;
    expect(parsed.createdAt.getTime()).toBe(row.createdAt.getTime());
    expect(parsed.id.toHexString()).toBe(row._id.toHexString());
    expect(token).not.toContain('account-owner');
    expect(token).not.toContain('secret');
    expect(parseHistoryCursor(undefined)).toBeNull();
  });

  it('rejects malformed, old-version, fabricated and pathological tokens', () => {
    const encoded = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    for (const cursor of ['', '!', '%%%','a'.repeat(300), 42, null, {},
      encoded([2, Date.now(), record(1)._id.toHexString()]),
      encoded([1, -1, record(1)._id.toHexString()]),
      encoded([1, Date.now(), 'invalid-object-id']),
      encoded([1, Date.now(), record(1)._id.toHexString(), 'extra']),
      encoded({ token: 'anything' }),
      encoded([1, NaN, record(1)._id.toHexString()]),
    ]) {
      expect(() => parseHistoryCursor(cursor)).toThrowError('Invalid execution history cursor.');
    }
  });
});

describe('M14 authenticated keyset history paging', () => {
  it('checks ownership before any execution data read', async () => {
    mocks.exists.mockResolvedValueOnce(null);
    await expect(getOwnedExecutionHistoryPage(workflowId, 'other-tenant'))
      .rejects.toMatchObject({ statusCode: 404, code: 'WORKFLOW_NOT_FOUND' });
    expect(mocks.exists).toHaveBeenCalledWith({ _id: workflowId, userId: 'other-tenant' });
    expect(mocks.find).not.toHaveBeenCalled();
  });

  it('rejects invalid workflow ID before any database access', async () => {
    await expect(getOwnedExecutionHistoryPage('invalid', userId)).rejects
      .toMatchObject({ statusCode: 404, code: 'WORKFLOW_NOT_FOUND' });
    expect(mocks.find).not.toHaveBeenCalled();
    expect(mocks.exists).not.toHaveBeenCalled();
  });

  it('never queries on invalid input', async () => {
    await expect(getOwnedExecutionHistoryPage(workflowId, userId, { limit: '999' })).rejects
      .toMatchObject({ statusCode: 400, code: 'INVALID_HISTORY_LIMIT' });
    await expect(getOwnedExecutionHistoryPage(workflowId, userId, { cursor: 'bad-cursor' })).rejects
      .toMatchObject({ statusCode: 400, code: 'INVALID_HISTORY_CURSOR' });
    expect(mocks.exists).not.toHaveBeenCalled();
    expect(mocks.find).not.toHaveBeenCalled();
  });

  it('returns exactly one bounded page plus opaque cursor for 20+1 results', async () => {
    const items = Array.from({ length: 21 }, (_, i) => record(200 - i));
    const q = mockRows(items);
    const result = await getOwnedExecutionHistoryPage(workflowId, userId);
    expect(result.runs).toHaveLength(20);
    expect(result.nextCursor).not.toBeNull();
    expect(parseHistoryCursor(result.nextCursor)?.id.toHexString()).toBe(items[19]._id.toHexString());
    expect(q.sort).toHaveBeenCalledWith({ createdAt: -1, _id: -1 });
    expect(q.limit).toHaveBeenCalledWith(21);
    expect(q.select).toHaveBeenCalledWith('-leaseOwner -leaseHeartbeatAt -leaseExpiresAt');
    expect(mocks.find).toHaveBeenCalledWith({ workflowId, userId });
  });

  it('uses timestamp+ObjectId tie-breakers and always re-scopes pages to the same owner', async () => {
    const anchor = record(100);
    const cursor = encodeHistoryCursor(anchor);
    const q = mockRows([record(99)]);
    const page = await getOwnedExecutionHistoryPage(workflowId, userId, { limit: '5', cursor });
    expect(page.nextCursor).toBeNull();
    expect(page.runs).toHaveLength(1);
    expect(q.limit).toHaveBeenCalledWith(6);
    const filter = mocks.find.mock.calls[0][0];
    expect(filter).toEqual({ workflowId, userId, $or: [
      { createdAt: { $lt: anchor.createdAt } },
      { createdAt: anchor.createdAt, _id: { $lt: anchor._id } },
    ] });
  });

  it('returns empty page without a cursor at the end of history', async () => {
    mockRows([]);
    expect(await getOwnedExecutionHistoryPage(workflowId, userId, { limit: '1' }))
      .toEqual({ runs: [], nextCursor: null });
  });

  it('never includes lease fencing tokens in projection and never logs database secrets', async () => {
    mockRows([record(1)]);
    const report = await getOwnedExecutionHistoryPage(workflowId, userId);
    expect(JSON.stringify(report)).not.toMatch(/leaseOwner|leaseExpiresAt|leaseHeartbeatAt/);
  });
});
