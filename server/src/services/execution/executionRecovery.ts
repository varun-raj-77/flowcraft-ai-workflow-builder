import { randomUUID } from 'node:crypto';
import { ExecutionRun, type IExecutionRunDocument, type IStepLog } from '../../models/ExecutionRun.model';

// The heartbeat is intentionally much more frequent than the expiry window:
// a short DB/network interruption must not cause premature recovery.
export const EXECUTION_LEASE_MS = 120_000;
export const EXECUTION_HEARTBEAT_MS = 15_000;
export const EXECUTION_RECOVERY_SCAN_MS = 30_000;
export const EXECUTION_RECOVERY_BATCH = 25;

export const EXECUTION_INTERRUPTED_MESSAGE =
  'Execution interrupted after its worker lease expired. No steps were replayed.';

export class ExecutionLeaseLostError extends Error {
  constructor() {
    super('Execution lease is no longer owned by this worker');
    this.name = 'ExecutionLeaseLostError';
  }
}

/** Each run gets a unique, non-reusable fencing token, including across restarts. */
export function newExecutionLease(now = new Date()) {
  return {
    leaseOwner: randomUUID(),
    leaseHeartbeatAt: now,
    leaseExpiresAt: new Date(now.getTime() + EXECUTION_LEASE_MS),
  };
}

/**
 * Refresh ownership atomically, conditioned on the run still being running
 * and the lease not already expiring. Never reacquire an expired lease.
 */
export async function renewExecutionLease(run: IExecutionRunDocument): Promise<void> {
  if (!run.leaseOwner) return; // Historical in-flight records only, no retroactive takeover.
  const now = new Date();
  const result = await ExecutionRun.updateOne({
    _id: run._id,
    userId: run.userId,
    status: 'running',
    leaseOwner: run.leaseOwner,
    leaseExpiresAt: { $gt: now },
  }, {
    $set: {
      leaseHeartbeatAt: now,
      leaseExpiresAt: new Date(now.getTime() + EXECUTION_LEASE_MS),
    },
  });
  if (result.matchedCount !== 1) throw new ExecutionLeaseLostError();
}

/**
 * Save progress/final results using the same ownership fence as heartbeats.
 * A slow/stale worker cannot overwrite a terminal state written by recovery.
 */
export async function persistExecutionSnapshot(run: IExecutionRunDocument): Promise<void> {
  if (!run.leaseOwner) {
    // Existing unit fixtures and runs initialized by a pre-M9 server version.
    await run.save();
    return;
  }
  const now = new Date();
  const result = await ExecutionRun.updateOne({
    _id: run._id,
    userId: run.userId,
    status: 'running',
    leaseOwner: run.leaseOwner,
    leaseExpiresAt: { $gt: now },
  }, {
    $set: {
      status: run.status,
      stepLogs: run.stepLogs,
      ...(run.completedAt ? { completedAt: run.completedAt } : {}),
      ...(run.error ? { error: run.error } : {}),
    },
  }, { runValidators: true });
  if (result.matchedCount !== 1) throw new ExecutionLeaseLostError();
}

interface ExpiredRun {
  _id: IExecutionRunDocument['_id'];
  userId: string;
  leaseOwner: string;
  leaseExpiresAt: Date;
  stepLogs: IStepLog[];
}

/** Pure projection; keep already completed or skipped steps unchanged. */
export function recoveredSteps(steps: readonly IStepLog[], at: Date): IStepLog[] {
  return steps.map((step) => {
    if (step.status === 'pending') return { ...step, status: 'skipped' };
    if (step.status !== 'running') return { ...step };
    const started = step.startedAt instanceof Date
      ? step.startedAt.getTime() : Number.NaN;
    return {
      ...step,
      status: 'failed',
      completedAt: at,
      durationMs: Number.isFinite(started) ? Math.max(0, at.getTime() - started) : 0,
      error: 'Worker stopped before this step completed',
    };
  });
}

/**
 * A read plus a compare-and-set, NEVER two writes and NEVER replay. Recovery
 * competes safely with a heartbeat, final persistence and another scanner.
 *
 * No owner/user workflow data or arbitrary exception messages are logged.
 */
export async function recoverExpiredExecutions(
  now = new Date(),
  limit = EXECUTION_RECOVERY_BATCH,
): Promise<number> {
  const candidates = await ExecutionRun.find({
    status: 'running',
    leaseOwner: { $type: 'string' },
    leaseExpiresAt: { $lte: now },
  }).sort({ leaseExpiresAt: 1 }).limit(limit).lean() as unknown as ExpiredRun[];

  let recovered = 0;
  for (const run of candidates) {
    if (typeof run.leaseOwner !== 'string' || !run.leaseOwner
      || !(run.leaseExpiresAt instanceof Date) || !Array.isArray(run.stepLogs)) continue;

    const result = await ExecutionRun.updateOne({
      _id: run._id,
      userId: run.userId,
      status: 'running',
      leaseOwner: run.leaseOwner,
      leaseExpiresAt: run.leaseExpiresAt, // Critical compare-and-set vs renewal.
    }, {
      $set: {
        status: 'failed',
        error: EXECUTION_INTERRUPTED_MESSAGE,
        completedAt: now,
        stepLogs: recoveredSteps(run.stepLogs, now),
      },
    }, { runValidators: true });
    if (result.modifiedCount === 1) recovered += 1;
  }
  return recovered;
}

/** Fire-and-forget from server startup, then continuously, without overlap. */
export function startExecutionRecoveryMonitor() {
  let busy = false;
  let closed = false;
  const sweep = async () => {
    if (busy || closed) return;
    busy = true;
    try {
      const recovered = await recoverExpiredExecutions();
      if (recovered) {
        console.info(JSON.stringify({ event: 'execution_recovery', recovered }));
      }
    } catch {
      console.warn(JSON.stringify({ event: 'execution_recovery_failed' }));
    } finally {
      busy = false;
    }
  };
  void sweep();
  const interval = setInterval(() => { void sweep(); }, EXECUTION_RECOVERY_SCAN_MS);
  interval.unref();
  return () => {
    closed = true;
    clearInterval(interval);
  };
}
