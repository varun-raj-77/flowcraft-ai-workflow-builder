import type { ExecutionRun, StepLog, StepStatus } from '@/types';
import { getRunSummary } from './executionInspector';

export const INTERRUPTED_EXECUTION_ERROR = 'Execution interrupted after its worker lease expired. No steps were replayed.';
export type HistoryStatusFilter = 'all' | ExecutionRun['status'];

export function filterHistoryRuns(runs: readonly ExecutionRun[], status: HistoryStatusFilter): ExecutionRun[] {
  return status === 'all' ? [...runs] : runs.filter((run) => run.status === status);
}

export interface RunDiagnosis {
  kind: 'interrupted' | 'api' | 'transform' | 'condition' | 'other' | 'running' | 'success';
  title: string;
  description: string;
  nextAction: string;
  failedNodeId: string | null;
}

/** A generic diagnosis is a lead for inspection, not a claim about root cause.
 * Never include arbitrary error, input, output, code, URLs or user-authored labels.
 */
export function diagnoseRun(run: ExecutionRun): RunDiagnosis {
  if (run.status === 'running') return {
    kind: 'running', title: 'Execution in progress',
    description: 'Some node results are not available yet.',
    nextAction: 'Inspect the timeline as new steps complete.', failedNodeId: null,
  };
  if (run.status === 'completed') return {
    kind: 'success', title: 'Execution completed',
    description: 'All required execution steps finished without a recorded failure.',
    nextAction: 'Inspect the timeline for durations and recorded outputs.', failedNodeId: null,
  };
  const failed = run.stepLogs.find((s) => s.status === 'failed');
  if (run.error === INTERRUPTED_EXECUTION_ERROR) return {
    kind: 'interrupted', title: 'Worker execution interrupted',
    description: 'The worker lease expired. A prior external request might already have succeeded.',
    nextAction: 'Review completed steps and possible external side effects before considering a new attempt.',
    failedNodeId: failed?.nodeId ?? null,
  };
  if (run.status === 'cancelled') return {
    kind: 'other', title: 'Execution cancelled',
    description: 'The run ended without completing all steps.',
    nextAction: 'Review the timeline to identify the last completed step.', failedNodeId: failed?.nodeId ?? null,
  };
  const kind = failed?.nodeType === 'api_call' ? 'api'
    : failed?.nodeType === 'transform' ? 'transform'
    : failed?.nodeType === 'condition' ? 'condition'
    : 'other';
  const details: Record<typeof kind, [string, string, string]> = {
    api: ['API step failed', 'An API step reported a failure; the response and network conditions need inspection.', 'Inspect the failed step’s recorded response, credentials and endpoint configuration. Do not blindly resend side-effectful requests.'],
    transform: ['Transformation failed', 'A transformation step could not process its recorded inputs.', 'Inspect the step’s structured diagnostic, available fields and code before making changes.'],
    condition: ['Condition step failed', 'A condition could not evaluate successfully.', 'Check the condition configuration and the available upstream fields.'],
    other: ['Execution failed', 'The run recorded a failure; its exact cause has not been established.', 'Inspect the first failed step and its recorded error details.'],
  };
  const [title, description, nextAction] = details[kind];
  return { kind, title, description, nextAction, failedNodeId: failed?.nodeId ?? null };
}

export interface ComparedStep {
  nodeId: string;
  nodeType: StepLog['nodeType'];
  before: StepStatus | 'missing';
  after: StepStatus | 'missing';
  beforeDurationMs: number | null;
  afterDurationMs: number | null;
  statusChanged: boolean;
}
export interface RunComparison {
  statusChanged: boolean;
  durationDifferenceMs: number | null;
  successCountDifference: number;
  skippedCountDifference: number;
  comparableSteps: boolean;
  steps: ComparedStep[];
  limited: boolean;
  note: string;
}
const MAX_COMPARED_STEPS = 100;
function validDuration(value: number | undefined): number | null {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : null;
}

/** Read-only metadata comparison. Pinned graph identity is mandatory before
 * aligning nodes; labels/outputs/config/errors are deliberately not compared.
 */
export function compareExecutionRuns(before: ExecutionRun, after: ExecutionRun): RunComparison {
  if (before.workflowId !== after.workflowId) throw new Error('Cannot compare executions from different workflows');
  const beforeSummary = getRunSummary(before);
  const afterSummary = getRunSummary(after);
  const beforeDuration = before.status !== 'running' ? beforeSummary.totalDurationMs : null;
  const afterDuration = after.status !== 'running' ? afterSummary.totalDurationMs : null;
  const durationDifferenceMs = beforeDuration !== null && afterDuration !== null
    && Number.isFinite(beforeDuration) && Number.isFinite(afterDuration)
    && beforeDuration >= 0 && afterDuration >= 0
    ? afterDuration - beforeDuration : null;
  const comparableSteps = Boolean(before.workflowRevisionId && after.workflowRevisionId
    && before.definitionHash && after.definitionHash
    && before.workflowRevisionId === after.workflowRevisionId
    && before.definitionHash === after.definitionHash
    && before.workflowRevision === after.workflowRevision);
  const base = {
    statusChanged: before.status !== after.status,
    durationDifferenceMs,
    successCountDifference: afterSummary.successfulSteps - beforeSummary.successfulSteps,
    skippedCountDifference: afterSummary.skippedSteps - beforeSummary.skippedSteps,
  };
  if (!comparableSteps) return {
    ...base, comparableSteps: false, steps: [], limited: false,
    note: 'These runs do not share a verified identical pinned revision. Compare summary counts only; node-level differences may be misleading.',
  };
  const oldSteps = new Map(before.stepLogs.map((step) => [step.nodeId, step]));
  const newSteps = new Map(after.stepLogs.map((step) => [step.nodeId, step]));
  const allIds = [...new Set([...oldSteps.keys(), ...newSteps.keys()])];
  const steps: ComparedStep[] = allIds.slice(0, MAX_COMPARED_STEPS).map((nodeId) => {
    const previous = oldSteps.get(nodeId);
    const current = newSteps.get(nodeId);
    const beforeStatus = previous?.status ?? 'missing';
    const afterStatus = current?.status ?? 'missing';
    return {
      nodeId,
      nodeType: (current ?? previous)!.nodeType,
      before: beforeStatus,
      after: afterStatus,
      beforeDurationMs: validDuration(previous?.durationMs),
      afterDurationMs: validDuration(current?.durationMs),
      statusChanged: beforeStatus !== afterStatus,
    };
  });
  return {
    ...base, comparableSteps: true, steps, limited: allIds.length > MAX_COMPARED_STEPS,
    note: before.status === 'running' || after.status === 'running'
      ? 'One run is still active. These are point-in-time step states, not final results.'
      : 'Only step status and recorded duration are compared. No API payloads, errors or secrets are included.',
  };
}
