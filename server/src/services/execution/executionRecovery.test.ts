import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  find: vi.fn(),
  updateOne: vi.fn(),
}));
vi.mock('../../models/ExecutionRun.model', () => ({
  ExecutionRun: { find: db.find, updateOne: db.updateOne },
}));

import {
  EXECUTION_INTERRUPTED_MESSAGE,
  EXECUTION_LEASE_MS,
  EXECUTION_RECOVERY_BATCH,
  ExecutionLeaseLostError,
  newExecutionLease,
  persistExecutionSnapshot,
  recoveredSteps,
  recoverExpiredExecutions,
  renewExecutionLease,
} from './executionRecovery';

const at = new Date('2026-10-18T08:00:00.000Z');
const prev = new Date(at.getTime() - 150_000);
const old = new Date(at.getTime() - 40_000);
const oid = { toString: () => 'run-1' };

const candidate = (override: Record<string, unknown> = {}) => ({
  _id: oid, userId: 'owner-1', leaseOwner: 'unique-worker-token',
  leaseExpiresAt: old,
  stepLogs: [
    { nodeId: 'start', nodeType: 'start', nodeLabel: 'Start', status: 'success', startedAt: prev, completedAt: prev, durationMs: 12 },
    { nodeId: 'work', nodeType: 'api_call', nodeLabel: 'API', status: 'running', startedAt: prev },
    { nodeId: 'later', nodeType: 'output', nodeLabel: 'Output', status: 'pending' },
    { nodeId: 'branch', nodeType: 'output', nodeLabel: 'Skipped', status: 'skipped' },
  ],
  ...override,
});

function query(rows: unknown[]) {
  const lean = vi.fn().mockResolvedValue(rows);
  const limit = vi.fn().mockReturnValue({ lean });
  const sort = vi.fn().mockReturnValue({ limit });
  db.find.mockReturnValue({ sort });
  return { sort, limit, lean };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
  query([candidate()]);
});

describe('M9 lease issuance and fenced progress', () => {
  it('uses non-repeating worker fencing tokens and a 120 second lease', () => {
    const first = newExecutionLease(at);
    const second = newExecutionLease(at);
    expect(first.leaseOwner).not.toBe(second.leaseOwner);
    expect(first.leaseOwner).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.leaseHeartbeatAt).toEqual(at);
    expect(first.leaseExpiresAt.getTime() - at.getTime()).toBe(EXECUTION_LEASE_MS);
  });

  it('renews only with the correct owner, current running status and unexpired lease', async () => {
    await renewExecutionLease({ _id: oid, userId: 'owner-1', leaseOwner: 'token' } as never);
    expect(db.updateOne).toHaveBeenCalledWith(expect.objectContaining({
      _id: oid, userId: 'owner-1', status: 'running', leaseOwner: 'token',
      leaseExpiresAt: { $gt: expect.any(Date) },
    }), {
      $set: { leaseHeartbeatAt: expect.any(Date), leaseExpiresAt: expect.any(Date) },
    });
  });

  it('fails stopped workers closed: no takeover or resurrection after losing ownership', async () => {
    db.updateOne.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });
    await expect(renewExecutionLease({ _id: oid, userId: 'owner-1', leaseOwner: 'stale' } as never))
      .rejects.toBeInstanceOf(ExecutionLeaseLostError);
    expect(db.updateOne).toHaveBeenCalledTimes(1);
  });

  it('fences successful terminal snapshots by live ownership and never delegates to stale document.save', async () => {
    const save = vi.fn();
    const run = {
      _id: oid, userId: 'owner-1', leaseOwner: 'token',
      status: 'completed', completedAt: at, stepLogs: [],
      save,
    };
    await persistExecutionSnapshot(run as never);
    expect(db.updateOne).toHaveBeenCalledWith(expect.objectContaining({
      status: 'running', leaseOwner: 'token', userId: 'owner-1',
      leaseExpiresAt: { $gt: expect.any(Date) },
    }), {
      $set: { status: 'completed', completedAt: at, stepLogs: [] },
    }, { runValidators: true });
    expect(save).not.toHaveBeenCalled();
  });

  it('rejects stale snapshots instead of overwriting the recovery terminal status', async () => {
    db.updateOne.mockResolvedValue({ matchedCount: 0 });
    await expect(persistExecutionSnapshot({
      _id: oid, userId: 'owner-1', leaseOwner: 'token', status: 'completed', stepLogs: [],
    } as never)).rejects.toBeInstanceOf(ExecutionLeaseLostError);
  });

  it('leaves legacy runs unclaimed and preserves existing save behavior', async () => {
    const save = vi.fn();
    await renewExecutionLease({ _id: oid, userId: 'legacy' } as never);
    await persistExecutionSnapshot({ _id: oid, userId: 'legacy', save } as never);
    expect(save).toHaveBeenCalledOnce();
    expect(db.updateOne).not.toHaveBeenCalled();
  });
});

describe('M9 crash reconciliation: no replay, compare-and-set races', () => {
  it('marks interrupted nodes failed, remaining nodes skipped, and retains completed steps', () => {
    const steps = candidate().stepLogs;
    const result = recoveredSteps(steps as never, at);
    expect(result.map(s => s.status)).toEqual(['success', 'failed', 'skipped', 'skipped']);
    expect(result[0]).toMatchObject({ durationMs: 12, completedAt: prev });
    expect(result[1]).toMatchObject({
      error: 'Worker stopped before this step completed',
      completedAt: at, durationMs: at.getTime() - prev.getTime(),
    });
    expect(steps[1].status).toBe('running');
  });

  it('scans a bounded number of only expired running leased records', async () => {
    const q = query([candidate()]);
    expect(await recoverExpiredExecutions(at)).toBe(1);
    expect(db.find).toHaveBeenCalledWith({
      status: 'running',
      leaseOwner: { $type: 'string' },
      leaseExpiresAt: { $lte: at },
    });
    expect(q.sort).toHaveBeenCalledWith({ leaseExpiresAt: 1 });
    expect(q.limit).toHaveBeenCalledWith(EXECUTION_RECOVERY_BATCH);
    expect(db.updateOne).toHaveBeenCalledWith({
      _id: oid, userId: 'owner-1', status: 'running',
      leaseOwner: 'unique-worker-token', leaseExpiresAt: old,
    }, expect.objectContaining({
      $set: expect.objectContaining({
        status: 'failed', error: EXECUTION_INTERRUPTED_MESSAGE,
        completedAt: at, stepLogs: expect.arrayContaining([
          expect.objectContaining({ nodeId: 'work', status: 'failed' }),
          expect.objectContaining({ nodeId: 'later', status: 'skipped' }),
        ]),
      }),
    }), { runValidators: true });
    expect(JSON.stringify(db.updateOne.mock.calls)).not.toContain('execute');
  });

  it('does not touch healthy or legacy runs returned by an empty scoped scan', async () => {
    query([]);
    expect(await recoverExpiredExecutions(at)).toBe(0);
    expect(db.updateOne).not.toHaveBeenCalled();
  });

  it('a heartbeat changing the expiry defeats a recovery claim', async () => {
    db.updateOne.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });
    expect(await recoverExpiredExecutions(at)).toBe(0);
    expect(db.updateOne).toHaveBeenCalledTimes(1);
    expect(db.updateOne.mock.calls[0][0]).toHaveProperty('leaseExpiresAt', old);
  });

  it('two workers competing for one expired run cannot both finalize it', async () => {
    let status = 'running';
    db.updateOne.mockImplementation(async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
      if (status !== 'running' || filter.leaseExpiresAt !== old) return { modifiedCount: 0 };
      if ((update.$set as Record<string, unknown>).status !== 'failed') throw Error('unexpected replay');
      status = 'failed';
      return { modifiedCount: 1 };
    });
    const [a, b] = await Promise.all([recoverExpiredExecutions(at), recoverExpiredExecutions(at)]);
    expect(a + b).toBe(1);
    expect(db.updateOne).toHaveBeenCalledTimes(2);
  });

  it('does not claim a record whose revision/lease data cannot safely be compared', async () => {
    query([
      candidate({ leaseOwner: '' }),
      candidate({ leaseExpiresAt: 'not-a-date' }),
      candidate({ stepLogs: 'corrupt' }),
    ]);
    expect(await recoverExpiredExecutions(at)).toBe(0);
    expect(db.updateOne).not.toHaveBeenCalled();
  });

  it('does not quietly turn a failed write into a successful recovery', async () => {
    db.updateOne.mockRejectedValue(new Error('synthetic DB outage'));
    await expect(recoverExpiredExecutions(at)).rejects.toThrow('synthetic DB outage');
  });
});
