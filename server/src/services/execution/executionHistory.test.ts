import { beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';

const mocks = vi.hoisted(() => ({ exists: vi.fn(), find: vi.fn() }));
vi.mock('../../models/Workflow.model', () => ({ Workflow: { exists: mocks.exists } }));
vi.mock('../../models/ExecutionRun.model', () => ({ ExecutionRun: { find: mocks.find } }));

import {
  EXECUTION_HISTORY_PAGE_SIZE, EXECUTION_HISTORY_PUBLIC_FIELDS, EXECUTION_HISTORY_SUMMARY_FIELDS,
  EXECUTION_HISTORY_QUERY_TIMEOUT_MS,
  encodeHistoryCursor, getOwnedExecutionHistoryPage, parseHistoryCursor, parseHistoryLimit, parseHistoryStatus, parseHistoryView,
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
  const maxTimeMS = vi.fn().mockReturnValue({ lean });
  const select = vi.fn().mockReturnValue({ maxTimeMS });
  const limit = vi.fn().mockReturnValue({ select });
  const sort = vi.fn().mockReturnValue({ limit });
  mocks.find.mockReturnValue({ sort });
  return { sort, limit, select, maxTimeMS, lean };
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
    expect(q.select).toHaveBeenCalledWith(EXECUTION_HISTORY_PUBLIC_FIELDS);
    expect(q.maxTimeMS).toHaveBeenCalledWith(EXECUTION_HISTORY_QUERY_TIMEOUT_MS);
    expect(EXECUTION_HISTORY_PUBLIC_FIELDS.split(' ')).toEqual(expect.arrayContaining([
      '_id', 'workflowId', 'userId', 'stepLogs', 'executionOrder', 'definitionHash',
      'workflowRevisionId', 'retryOfRunId', 'createdAt', 'updatedAt',
    ]));
    expect(EXECUTION_HISTORY_PUBLIC_FIELDS).not.toMatch(/leaseOwner|leaseExpiresAt|leaseHeartbeatAt/);
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

describe('M15 tenant-safe server-filtered execution history', () => {
  it('accepts only an exact status enum and defaults to all', () => {
    expect(parseHistoryStatus(undefined)).toBe('all');
    for (const status of ['all','running','completed','failed','cancelled']) {
      expect(parseHistoryStatus(status)).toBe(status);
    }
    for (const invalid of ['', 'FAiled', 'pending', ['failed'], { $ne: 'completed' }, 1, null, 'failed ']) {
      expect(() => parseHistoryStatus(invalid)).toThrowError('Invalid execution history status.');
    }
  });

  it('binds filtered page cursors to the exact selected status without exposing data', () => {
    const first = record(51);
    const token = encodeHistoryCursor(first, 'failed');
    expect(parseHistoryCursor(token, 'failed')?.id.toString()).toBe(first._id.toString());
    expect(token).not.toMatch(/owner|secret/);
    for (const different of ['completed','running','cancelled','all'] as const) {
      expect(() => parseHistoryCursor(token, different)).toThrowError('Invalid execution history cursor.');
    }
    const oldUnfiltered = encodeHistoryCursor(first);
    expect(() => parseHistoryCursor(oldUnfiltered, 'failed')).toThrowError('Invalid execution history cursor.');
    expect(parseHistoryCursor(oldUnfiltered, 'all')?.id.toString()).toBe(first._id.toString());
  });

  it('scopes filtered queries by owner and status before applying keyset bounds', async () => {
    const anchor = record(71);
    const token = encodeHistoryCursor(anchor, 'failed');
    const q = mockRows([record(70)]);
    const page = await getOwnedExecutionHistoryPage(workflowId, userId,
      { status: 'failed', cursor: token, limit: '3' });
    expect(page.runs).toHaveLength(1);
    expect(page.nextCursor).toBeNull();
    expect(q.limit).toHaveBeenCalledWith(4);
    expect(mocks.find).toHaveBeenCalledWith({ workflowId, userId, status: 'failed',
      $or: [{ createdAt: { $lt: anchor.createdAt } },
        { createdAt: anchor.createdAt, _id: { $lt: anchor._id } }] });
  });

  it('only issues a next-page cursor for the current status', async () => {
    const q = mockRows([record(11), record(10)]);
    const page = await getOwnedExecutionHistoryPage(workflowId, userId, { status: 'failed', limit: '1' });
    expect(q.limit).toHaveBeenCalledWith(2);
    expect(page.runs).toHaveLength(1);
    expect(parseHistoryCursor(page.nextCursor, 'failed')?.id.toString()).toBe(record(11)._id.toString());
    expect(() => parseHistoryCursor(page.nextCursor, 'completed')).toThrow();
  });

  it('validates invalid status and filter-mismatched cursors before ownership DB reads', async () => {
    const token = encodeHistoryCursor(record(9), 'failed');
    await expect(getOwnedExecutionHistoryPage(workflowId, userId, { status: { $ne: 'failed' } }))
      .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_HISTORY_STATUS' });
    await expect(getOwnedExecutionHistoryPage(workflowId, userId, { status: 'completed', cursor: token }))
      .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_HISTORY_CURSOR' });
    expect(mocks.exists).not.toHaveBeenCalled();
    expect(mocks.find).not.toHaveBeenCalled();
  });

  it('refuses cross-tenant history even with a valid matching filtered cursor', async () => {
    mocks.exists.mockResolvedValueOnce(null);
    const token = encodeHistoryCursor(record(91), 'failed');
    await expect(getOwnedExecutionHistoryPage(workflowId, 'foreign-account', { status: 'failed', cursor: token }))
      .rejects.toMatchObject({ statusCode: 404, code: 'WORKFLOW_NOT_FOUND' });
    expect(mocks.find).not.toHaveBeenCalled();
  });
});

describe('M16 bounded execution history reads', () => {
  it('applies a finite server-side query budget to filtered and cursor pages', async () => {
    const q = mockRows([record(12)]);
    await getOwnedExecutionHistoryPage(workflowId, userId, {
      status: 'failed', cursor: encodeHistoryCursor(record(13), 'failed'), limit: '2',
    });
    expect(q.limit).toHaveBeenCalledWith(3);
    expect(q.maxTimeMS).toHaveBeenCalledWith(4_000);
    expect(q.select).toHaveBeenCalledWith(EXECUTION_HISTORY_PUBLIC_FIELDS);
  });

  it('returns a safe retryable 503 for MongoDB execution timeouts without leaking internals', async () => {
    const q = mockRows([]);
    q.lean.mockRejectedValueOnce(Object.assign(
      new Error('MongoServerError: credentials password=extremely-secret'), { code: 50 },
    ));
    const error = await getOwnedExecutionHistoryPage(workflowId, userId)
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ statusCode: 503, code: 'HISTORY_QUERY_TIMEOUT' });
    expect((error as Error).message).not.toMatch(/password|credentials|MongoServerError/);
    expect(mocks.exists).toHaveBeenCalledWith({ _id: workflowId, userId });
  });

  it('does not misclassify unrelated database failures as timeouts', async () => {
    const q = mockRows([]);
    const failure = Object.assign(new Error('database unavailable'), { code: 91 });
    q.lean.mockRejectedValueOnce(failure);
    await expect(getOwnedExecutionHistoryPage(workflowId, userId)).rejects.toBe(failure);
  });

  it('never reaches query execution for unauthorized workflows', async () => {
    mocks.exists.mockResolvedValueOnce(null);
    const q = mockRows([]);
    await expect(getOwnedExecutionHistoryPage(workflowId, 'different-tenant')).rejects
      .toMatchObject({ statusCode: 404, code: 'WORKFLOW_NOT_FOUND' });
    expect(mocks.find).not.toHaveBeenCalled();
    expect(q.maxTimeMS).not.toHaveBeenCalled();
  });
});

describe('M18 opt-in payload-free history pages', () => {
  it('requires an exact view enum before any database access', async () => {
    expect(parseHistoryView(undefined)).toBe('full');
    expect(parseHistoryView('full')).toBe('full');
    expect(parseHistoryView('summary')).toBe('summary');
    for (const invalid of ['', 'Summary', null, [], ['summary'], { $ne: 'full' }, 0]) {
      expect(() => parseHistoryView(invalid)).toThrowError('Invalid execution history view.');
      await expect(getOwnedExecutionHistoryPage(workflowId, userId, { view: invalid }))
        .rejects.toMatchObject({ statusCode: 400, code: 'INVALID_HISTORY_VIEW' });
    }
    expect(mocks.exists).not.toHaveBeenCalled();
    expect(mocks.find).not.toHaveBeenCalled();
  });

  it('projects only run and step metadata in summary mode, preserving cursor and ownership checks', async () => {
    const rows = [record(24), record(23)];
    const q = mockRows(rows);
    const result = await getOwnedExecutionHistoryPage(workflowId, userId,
      { view: 'summary', status: 'failed', limit: '1' });
    expect(result.runs).toHaveLength(1);
    expect(parseHistoryCursor(result.nextCursor, 'failed')?.id.toHexString())
      .toBe(rows[0]._id.toHexString());
    expect(mocks.exists).toHaveBeenCalledWith({ _id: workflowId, userId });
    expect(mocks.find).toHaveBeenCalledWith({ workflowId, userId, status: 'failed' });
    expect(q.limit).toHaveBeenCalledWith(2);
    expect(q.maxTimeMS).toHaveBeenCalledWith(EXECUTION_HISTORY_QUERY_TIMEOUT_MS);
    expect(q.select).toHaveBeenCalledWith(EXECUTION_HISTORY_SUMMARY_FIELDS);
    const fields = EXECUTION_HISTORY_SUMMARY_FIELDS.split(' ');
    for (const needed of [
      '_id', 'workflowId', 'userId', 'status', 'startedAt', 'completedAt',
      'workflowRevisionId', 'workflowRevision', 'definitionHash', 'createdAt',
      'stepLogs.nodeId', 'stepLogs.nodeType', 'stepLogs.nodeLabel',
      'stepLogs.status', 'stepLogs.durationMs',
    ]) expect(fields).toContain(needed);
    for (const unsafe of [
      'stepLogs', 'stepLogs.input', 'stepLogs.output', 'stepLogs.error',
      'stepLogs.diagnostic', 'error', 'leaseOwner', 'leaseExpiresAt',
    ]) expect(fields).not.toContain(unsafe);
  });

  it('keeps full-history projection as the default for legacy clients', async () => {
    const q = mockRows([record(5)]);
    await getOwnedExecutionHistoryPage(workflowId, userId);
    expect(q.select).toHaveBeenCalledWith(EXECUTION_HISTORY_PUBLIC_FIELDS);
    await getOwnedExecutionHistoryPage(workflowId, userId, { view: 'full' });
    expect(q.select).toHaveBeenCalledWith(EXECUTION_HISTORY_PUBLIC_FIELDS);
  });

  it('does not read any run metadata for another user even in summary mode', async () => {
    mocks.exists.mockResolvedValueOnce(null);
    const q = mockRows([record(1)]);
    await expect(getOwnedExecutionHistoryPage(workflowId, 'foreign-user', { view: 'summary' }))
      .rejects.toMatchObject({ statusCode: 404, code: 'WORKFLOW_NOT_FOUND' });
    expect(mocks.find).not.toHaveBeenCalled();
    expect(q.select).not.toHaveBeenCalled();
  });
});
