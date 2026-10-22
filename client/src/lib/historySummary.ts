import type { ExecutionHistorySummaryRun, ExecutionRun } from '@/types';

/**
 * M19: retain only an explicit metadata allowlist in the browser history store.
 *
 * Older backend deployments may ignore `view=summary` and return full step
 * inputs, outputs, diagnostics, errors and future model fields. TypeScript's
 * summary type does not strip those values at runtime. A fresh object for
 * every run and step prevents accidental retention of sensitive payloads.
 *
 * This is defense-in-depth, not a substitute for the M18 server-side
 * projection: legacy servers still transfer full records over the network.
 */
export function toHistorySummaryRun(run: ExecutionRun | ExecutionHistorySummaryRun): ExecutionHistorySummaryRun {
  return {
    _id: run._id,
    workflowId: run.workflowId,
    userId: run.userId,
    status: run.status,
    startedAt: run.startedAt,
    triggerType: run.triggerType,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    executionOrder: run.executionOrder.filter((nodeId): nodeId is string => typeof nodeId === 'string'),
    ...(typeof run.retryOfRunId === 'string' ? { retryOfRunId: run.retryOfRunId } : {}),
    ...(typeof run.workflowRevisionId === 'string' ? { workflowRevisionId: run.workflowRevisionId } : {}),
    ...(typeof run.workflowRevision === 'number' && Number.isSafeInteger(run.workflowRevision)
      ? { workflowRevision: run.workflowRevision } : {}),
    ...(typeof run.definitionHash === 'string' ? { definitionHash: run.definitionHash } : {}),
    ...(typeof run.completedAt === 'string' ? { completedAt: run.completedAt } : {}),
    stepLogs: run.stepLogs.map((step) => ({
      nodeId: step.nodeId,
      nodeType: step.nodeType,
      nodeLabel: step.nodeLabel,
      status: step.status,
      ...(typeof step.durationMs === 'number' && Number.isFinite(step.durationMs) && step.durationMs >= 0
        ? { durationMs: step.durationMs } : {}),
    })),
  };
}
