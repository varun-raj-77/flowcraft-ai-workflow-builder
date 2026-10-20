import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EXECUTION_INTERRUPTED_MESSAGE } from './executionRecovery';

const db = vi.hoisted(() => ({
  workflowExists: vi.fn(),
  find: vi.fn(),
  indexes: vi.fn(),
}));

vi.mock('../../models/Workflow.model', () => ({
  Workflow: { exists: db.workflowExists },
}));
vi.mock('../../models/ExecutionRun.model', () => ({
  ExecutionRun: {
    find: db.find,
    collection: { indexes: db.indexes },
  },
}));

import {
  EXECUTION_DIAGNOSTICS_LIMIT,
  assessHistoryIndexReadiness,
  checkRetryReadiness,
  getOwnedExecutionDiagnostics,
  isRetryIndexReady,
  logExecutionOutcome,
  summarizeExecutionRows,
} from './executionObservability';

const workflowId = '507f1f77bcf86cd799439011';
const now = new Date('2026-10-18T12:00:00.000Z');
const validIndex = {
  key: { retryOfRunId: 1 }, unique: true,
  partialFilterExpression: { retryOfRunId: { $type: 'objectId' } },
};
const unfilteredHistoryIndex = { key: { workflowId: 1, userId: 1, createdAt: -1, _id: -1 } };
const filteredHistoryIndex = { key: { workflowId: 1, userId: 1, status: 1, createdAt: -1, _id: -1 } };

function rows(result: unknown[]) {
  const lean = vi.fn().mockResolvedValue(result);
  const select = vi.fn().mockReturnValue({ lean });
  const limit = vi.fn().mockReturnValue({ select });
  const sort = vi.fn().mockReturnValue({ limit });
  db.find.mockReturnValue({ sort });
  return { lean, select, limit, sort };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.workflowExists.mockResolvedValue({ _id: workflowId });
  db.indexes.mockResolvedValue([validIndex]);
  rows([]);
});

describe('M11 retry index catalog readiness', () => {
  it('requires exactly one indexed field, unique and ObjectId partial filter', () => {
    expect(isRetryIndexReady([validIndex])).toBe(true);
    expect(isRetryIndexReady([])).toBe(false);
    expect(isRetryIndexReady([{ ...validIndex, unique: false }])).toBe(false);
    expect(isRetryIndexReady([{ ...validIndex, key: { retryOfRunId: 1, userId: 1 } }])).toBe(false);
    expect(isRetryIndexReady([{ ...validIndex, partialFilterExpression: { retryOfRunId: { $type: 'string' } } }])).toBe(false);
    expect(isRetryIndexReady([{ ...validIndex, key: { retryOfRunId: -1 } }])).toBe(false);
  });

  it('reports ready/not_ready/unavailable without leaking DB errors', async () => {
    expect(await checkRetryReadiness()).toBe('ready');
    db.indexes.mockResolvedValueOnce([]);
    expect(await checkRetryReadiness()).toBe('not_ready');
    db.indexes.mockRejectedValueOnce(new Error('mongodb uri password=private-secret'));
    expect(await checkRetryReadiness()).toBe('unavailable');
  });
});

describe('M11 owner-isolated, bounded execution diagnostics', () => {
  it('counts status, interrupted retries and durations accurately', () => {
    const input = [
      { status: 'completed', startedAt: new Date(now.getTime() - 200), completedAt: now },
      { status: 'failed', error: EXECUTION_INTERRUPTED_MESSAGE, retryOfRunId: 'secret-source-id', startedAt: new Date(now.getTime() - 1000), completedAt: now },
      { status: 'failed', error: 'password=confidential-body', startedAt: new Date(now.getTime() - 500), completedAt: now },
      { status: 'running', leaseExpiresAt: new Date(now.getTime() - 1) },
      { status: 'running', leaseExpiresAt: new Date(now.getTime() + 5000) },
      { status: 'cancelled', startedAt: new Date(now.getTime() - 300), completedAt: now },
      { status: 'completed', startedAt: new Date(now.getTime() + 10), completedAt: now },
    ] as const;
    const summary = summarizeExecutionRows(input, now);
    expect(summary.counts).toEqual({
      running: 2, completed: 2, failed: 2, cancelled: 1,
      interrupted: 1, otherFailures: 1, retriedAttempts: 1,
      expiredRunningLeases: 1,
    });
    expect(summary.averageTerminalDurationMs).toBe(500); // (200+1000+500+300)/4
    expect(summary.sampleSize).toBe(input.length);
    expect(JSON.stringify(summary)).not.toMatch(/confidential-body|secret-source-id|password|leaseOwner|nodeLabel/);
    expect(summary.sampleLimit).toBe(EXECUTION_DIAGNOSTICS_LIMIT);
  });

  it('treats invalid dates safely and yields null average when empty', () => {
    expect(summarizeExecutionRows([], now).averageTerminalDurationMs).toBeNull();
    const a = summarizeExecutionRows([{ status: 'failed', startedAt: new Date('bad'), completedAt: now }], now);
    expect(a.averageTerminalDurationMs).toBeNull();
    expect(a.counts.failed).toBe(1);
  });

  it('rejects an invalid workflow identifier before any database access', async () => {
    await expect(getOwnedExecutionDiagnostics('bad-id', 'owner', now))
      .rejects.toMatchObject({ code: 'WORKFLOW_NOT_FOUND', statusCode: 404 });
    expect(db.workflowExists).not.toHaveBeenCalled();
    expect(db.find).not.toHaveBeenCalled();
    expect(db.indexes).not.toHaveBeenCalled();
  });

  it('rejects cross-tenant or deleted workflows without probing runs or indexes', async () => {
    db.workflowExists.mockResolvedValueOnce(null);
    await expect(getOwnedExecutionDiagnostics(workflowId, 'different-user', now))
      .rejects.toMatchObject({ code: 'WORKFLOW_NOT_FOUND', statusCode: 404 });
    expect(db.workflowExists).toHaveBeenCalledWith({ _id: workflowId, userId: 'different-user' });
    expect(db.find).not.toHaveBeenCalled();
    expect(db.indexes).not.toHaveBeenCalled();
  });

  it('reads only the last 50 owned runs with a narrow private projection', async () => {
    const query = rows([{
      status: 'running', leaseExpiresAt: new Date(now.getTime() - 10),
      userId: 'private', error: 'secret do not expose', nodeLabel: 'personal',
    }]);
    const report = await getOwnedExecutionDiagnostics(workflowId, 'owner-1', now);
    expect(db.find).toHaveBeenCalledWith({ workflowId, userId: 'owner-1' });
    expect(query.sort).toHaveBeenCalledWith({ createdAt: -1 });
    expect(query.limit).toHaveBeenCalledWith(50);
    expect(query.select).toHaveBeenCalledWith('status error retryOfRunId startedAt completedAt leaseExpiresAt');
    expect(report.retryReadiness).toBe('ready');
    expect(report.historyIndexReadiness).toEqual({ unfiltered: 'not_ready', filtered: 'not_ready' });
    expect(report.counts.expiredRunningLeases).toBe(1);
    expect(JSON.stringify(report)).not.toMatch(/secret do not expose|private|personal|userId|workflowId/);
    expect(db.indexes).toHaveBeenCalledTimes(1);
  });

  it('remains a read-only report even when the retry index is unavailable', async () => {
    db.indexes.mockRejectedValueOnce(new Error('production DB connection string'));
    const report = await getOwnedExecutionDiagnostics(workflowId, 'owner', now);
    expect(report.retryReadiness).toBe('unavailable');
    expect(report.historyIndexReadiness).toEqual({ unfiltered: 'unavailable', filtered: 'unavailable' });
    expect(JSON.stringify(report)).not.toContain('production DB connection string');
    expect(db.find).toHaveBeenCalledTimes(1);
  });

  it('logs only fixed outcome enums and never arbitrary user content', () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    logExecutionOutcome('failed', 'node_failure');
    expect(log).toHaveBeenCalledWith(JSON.stringify({
      event: 'execution_terminal', status: 'failed', cause: 'node_failure',
    }));
    expect(log.mock.calls.flat().join('')).not.toMatch(/runId|label|secret|userId|workflowId/);
    log.mockRestore();
  });
});

describe('M16 read-only execution history index readiness', () => {
  it('requires both precise compound index shapes, not a weak prefix', () => {
    expect(assessHistoryIndexReadiness([])).toEqual({
      unfiltered: 'not_ready', filtered: 'not_ready',
    });
    expect(assessHistoryIndexReadiness([{ key: { workflowId: 1, createdAt: -1 } }]))
      .toEqual({ unfiltered: 'not_ready', filtered: 'not_ready' });
    expect(assessHistoryIndexReadiness([unfilteredHistoryIndex]))
      .toEqual({ unfiltered: 'ready', filtered: 'not_ready' });
    expect(assessHistoryIndexReadiness([unfilteredHistoryIndex, filteredHistoryIndex]))
      .toEqual({ unfiltered: 'ready', filtered: 'ready' });
  });

  it('rejects partial, hidden, sparse and collation-dependent indexes as proof of readiness', () => {
    for (const modification of [
      { partialFilterExpression: { status: 'failed' } }, { hidden: true },
      { sparse: true }, { collation: { locale: 'en' } },
    ]) {
      expect(assessHistoryIndexReadiness([{ ...filteredHistoryIndex, ...modification }]).filtered)
        .toBe('not_ready');
    }
    expect(assessHistoryIndexReadiness([
      { key: { workflowId: 1, userId: 1, createdAt: -1, status: 1, _id: -1 } },
    ]).filtered).toBe('not_ready');
  });

  it('reports both index states with the existing one-read owner-scoped diagnostics query', async () => {
    db.indexes.mockResolvedValueOnce([validIndex, unfilteredHistoryIndex, filteredHistoryIndex]);
    const report = await getOwnedExecutionDiagnostics(workflowId, 'owner', now);
    expect(report.retryReadiness).toBe('ready');
    expect(report.historyIndexReadiness).toEqual({ unfiltered: 'ready', filtered: 'ready' });
    expect(db.indexes).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(report)).not.toMatch(/retryOfRunId|partialFilterExpression|collection|mongo|secret/);
  });

  it('never reads index metadata for a workflow owned by another account', async () => {
    db.workflowExists.mockResolvedValueOnce(null);
    await expect(getOwnedExecutionDiagnostics(workflowId, 'unauthorized', now))
      .rejects.toMatchObject({ statusCode: 404, code: 'WORKFLOW_NOT_FOUND' });
    expect(db.indexes).not.toHaveBeenCalled();
    expect(db.find).not.toHaveBeenCalled();
  });
});
