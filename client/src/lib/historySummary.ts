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
    executionOrder: [...run.executionOrder],
    ...(run.retryOfRunId !== undefined ? { retryOfRunId: run.retryOfRunId } : {}),
    ...(run.workflowRevisionId !== undefined ? { workflowRevisionId: run.workflowRevisionId } : {}),
    ...(run.workflowRevision !== undefined ? { workflowRevision: run.workflowRevision } : {}),
    ...(run.definitionHash !== undefined ? { definitionHash: run.definitionHash } : {}),
    ...(run.completedAt !== undefined ? { completedAt: run.completedAt } : {}),
    stepLogs: run.stepLogs.map((step) => ({
      nodeId: step.nodeId,
      nodeType: step.nodeType,
      nodeLabel: step.nodeLabel,
      status: step.status,
      ...(step.durationMs !== undefined ? { durationMs: step.durationMs } : {}),
    })),
  };
}
