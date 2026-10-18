'use client';

import { useRef, useState } from 'react';
import * as api from '@/lib/api';
import type { ExecutionRun } from '@/types';
import { useExecutionStore } from '@/stores/executionStore';
import { useWorkflowStore } from '@/stores/workflowStore';
import { useUIStore } from '@/stores/uiStore';
import { useRevisionHistoryStore } from '@/stores/revisionHistoryStore';
import { useRevisionComparisonStore } from '@/stores/revisionComparisonStore';

export const INTERRUPTED_EXECUTION_MESSAGE =
  'Execution interrupted after its worker lease expired. No steps were replayed.';

export function InterruptedExecutionRecovery({ run }: { run: ExecutionRun }) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const setCurrentRun = useExecutionStore((state) => state.setCurrentRun);
  const setActiveInspectorTab = useExecutionStore((state) => state.setActiveInspectorTab);
  const isRunning = useExecutionStore((state) => state.isRunning);
  const selectedWorkflow = useWorkflowStore((state) => state.meta?._id);
  const isDirty = useWorkflowStore((state) => state.isDirty);
  const isPreview = useRevisionHistoryStore((state) => Boolean(state.previewRevision));
  const isComparing = useRevisionComparisonStore((state) => Boolean(state.comparison));
  if (run.status !== 'failed' || run.error !== INTERRUPTED_EXECUTION_MESSAGE) return null;

  const completed = run.stepLogs.filter((step) => step.status === 'success').length;
  const interrupted = run.stepLogs.filter((step) => step.status === 'failed');
  const remaining = run.stepLogs.filter((step) => step.status === 'skipped').length;
  const blocked = isRunning || selectedWorkflow !== run.workflowId || isDirty || isPreview || isComparing;

  const retry = async () => {
    if (inFlight.current || !acknowledged || blocked) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const attempt = await api.retryInterruptedExecution(run._id);
      if (useWorkflowStore.getState().meta?._id !== attempt.workflowId) return;
      setCurrentRun(attempt);
      setActiveInspectorTab('live');
      useUIStore.getState().setExecutionPanelOpen(true);
    } catch (cause) {
      setError(api.getApiErrorMessage(cause, 'Could not create a new attempt. No retry was started by this view.'));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  return <section aria-label="Interrupted execution recovery" className="mx-4 my-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-[var(--text-secondary)]">
    <p className="font-semibold text-amber-200">Execution interrupted after its worker stopped</p>
    <p className="mt-1">{completed} completed · {interrupted.length} interrupted · {remaining} not run. Completed steps are not resumed.</p>
    <p className="mt-2 font-medium">A previous API request may already have changed an external system. Starting a new attempt runs the entire saved workflow again and may repeat emails, payments, or updates.</p>
    {interrupted.length > 0 && <p className="mt-1">Interrupted step: {interrupted.map((step) => step.nodeLabel).join(', ')}</p>}
    {run.retryOfRunId && <p className="mt-1">This attempt was itself a retry of a previous execution.</p>}
    <label className="mt-3 flex items-start gap-2">
      <input type="checkbox" checked={acknowledged} disabled={blocked || pending} onChange={(event) => setAcknowledged(event.target.checked)} aria-label="Acknowledge possible duplicate external side effects" />
      <span>I understand external side effects may have already happened and I want one new attempt.</span>
    </label>
    <button type="button" onClick={() => { void retry(); }} disabled={!acknowledged || blocked || pending}
      className="mt-2 rounded-md bg-amber-600 px-3 py-1.5 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400">
      {pending ? 'Creating attempt…' : 'Start one new attempt'}
    </button>
    {blocked && <p className="mt-2 text-amber-200">Finish any running execution, save changes, and return to this workflow’s current revision to retry.</p>}
    {error && <p role="alert" className="mt-2 text-red-300">{error}</p>}
  </section>;
}
