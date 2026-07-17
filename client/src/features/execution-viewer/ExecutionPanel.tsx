'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useUIStore } from '@/stores/uiStore';
import { useWorkflowStore } from '@/stores/workflowStore';
import { useExecutionStore } from '@/stores/executionStore';
import { NODE_TYPE_REGISTRY } from '@/lib/constants';
import * as api from '@/lib/api';
import { cn } from '@/lib/utils';
import type { ExecutionRun, StepLog, StepStatus, TransformDiagnostic } from '@/types';
import { JsonViewer } from './JsonViewer';
import {
  INSPECTOR_TABS,
  type InspectorTab,
  buildTimelineSteps,
  formatDateTime,
  formatDuration,
  formatBytes,
  getPayloadDiff,
  getPayloadSize,
  getDurationBarPercent,
  getLongestDuration,
  getNextInspectorTab,
  getRunSummary,
  redactInspectionValue,
} from './executionInspector';

const STATUS_STYLES: Record<StepStatus, { dot: string; text: string; label: string }> = {
  pending: { dot: 'bg-zinc-300 dark:bg-zinc-600', text: 'text-zinc-500', label: 'Pending' },
  running: { dot: 'bg-blue-400 animate-pulse', text: 'text-blue-600 dark:text-blue-400', label: 'Running' },
  success: { dot: 'bg-emerald-400', text: 'text-emerald-600 dark:text-emerald-400', label: 'Success' },
  failed: { dot: 'bg-red-400', text: 'text-red-600 dark:text-red-400', label: 'Failed' },
  skipped: { dot: 'bg-zinc-300 dark:bg-zinc-600', text: 'text-zinc-400', label: 'Skipped' },
};

const RUN_STATUS_BADGE: Record<string, string> = {
  running: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  failed: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  cancelled: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
};

const TAB_LABELS: Record<InspectorTab, string> = {
  live: 'Live',
  timeline: 'Timeline',
  history: 'History',
  variables: 'Variables',
};

function SafeData({ value }: { value: unknown }) {
  return <JsonViewer value={value} />;
}

function TransformDiagnosticDetails({ diagnostic }: { diagnostic: TransformDiagnostic }) {
  return <section className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[10px] dark:border-red-900/50 dark:bg-red-950/20" aria-label="Transform diagnostic">
    <p className="font-semibold text-red-800 dark:text-red-200">{diagnostic.message}</p>
    {diagnostic.referencedPath && <p className="mt-1"><span className="font-medium">Referenced path:</span> <code>{diagnostic.referencedPath}</code></p>}
    {diagnostic.upstreamNodeId && <p className="mt-1"><span className="font-medium">Previous node:</span> {diagnostic.upstreamNodeName ?? diagnostic.upstreamNodeId} ({diagnostic.upstreamNodeId})</p>}
    {diagnostic.availableFields.length > 0 && <p className="mt-1"><span className="font-medium">Available fields:</span> {diagnostic.availableFields.join(', ')}</p>}
    <p className="mt-1"><span className="font-medium">Suggested action:</span> {diagnostic.suggestion}</p>
    <details className="mt-2"><summary className="cursor-pointer font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500">Technical details</summary><p className="mt-1 break-words">{redactInspectionValue(diagnostic.originalError) as string}</p></details>
  </section>;
}

function ResponseMetadata({ output, durationMs }: { output: Record<string, unknown>; durationMs?: number }) {
  const status = typeof output.status === 'number' ? output.status : null;
  const data = output.data;
  const headers = output.headers as Record<string, unknown> | undefined;
  const contentType = typeof headers?.['content-type'] === 'string' ? headers['content-type'] : null;
  const itemCount = Array.isArray(data) ? data.length : null;
  if (status === null && itemCount === null && !contentType) return null;
  return <p className="mt-1 text-[10px] text-zinc-500">Response metadata: {status !== null && `HTTP ${status}`}{durationMs != null && ` · ${formatDuration(durationMs)}`}{itemCount !== null && ` · ${itemCount} items`}{contentType && ` · ${contentType}`}</p>;
}

function PayloadDiffSummary({ input, output }: { input: unknown; output: unknown }) {
  const diff = useMemo(() => getPayloadDiff(input, output), [input, output]);
  const size = useMemo(() => getPayloadSize(output), [output]);
  const entries = [
    ...diff.added.map((key) => ({ key, prefix: '+', tone: 'text-emerald-600 dark:text-emerald-400' })),
    ...diff.removed.map((key) => ({ key, prefix: '−', tone: 'text-red-600 dark:text-red-400' })),
    ...diff.changed.map((key) => ({ key, prefix: '~', tone: 'text-amber-600 dark:text-amber-400' })),
  ];
  return <div className="mt-2 rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-[10px] dark:border-zinc-700 dark:bg-zinc-950">
    <div className="flex items-center justify-between gap-2 text-zinc-500"><span className="font-medium">Changes</span><span>{formatBytes(size)}</span></div>
    {entries.length === 0 ? <p className="mt-1 text-zinc-400">No top-level key changes.</p> : <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5">{entries.map(({ key, prefix, tone }) => <span key={`${prefix}-${key}`} className={tone}>{prefix} {key}</span>)}</div>}
  </div>;
}

function ReplayControl({ run }: { run: ExecutionRun }) {
  const steps = useMemo(() => buildTimelineSteps(run), [run]);
  const replayRunId = useExecutionStore((state) => state.replayRunId);
  const replayStepIndex = useExecutionStore((state) => state.replayStepIndex);
  const setReplayStep = useExecutionStore((state) => state.setReplayStep);
  const clearReplay = useExecutionStore((state) => state.clearReplay);
  if (steps.length === 0) return null;
  const value = replayRunId === run._id && replayStepIndex !== null ? replayStepIndex : steps.length - 1;
  return <div className="border-b border-zinc-100 bg-blue-50/50 px-4 py-2 dark:border-zinc-800 dark:bg-blue-950/10">
    <div className="flex items-center justify-between gap-2"><label htmlFor={`execution-replay-${run._id}`} className="text-[10px] font-medium text-zinc-600 dark:text-zinc-300">Replay</label>{replayRunId === run._id && <button type="button" onClick={clearReplay} className="text-[10px] text-blue-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-blue-400">Exit replay</button>}</div>
    <input id={`execution-replay-${run._id}`} aria-label="Replay execution progress" type="range" min="0" max={Math.max(0, steps.length - 1)} value={value} onChange={(event) => setReplayStep(run._id, Number(event.target.value))} className="mt-1 h-1.5 w-full cursor-pointer accent-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" />
    <p className="mt-1 text-[10px] text-zinc-500">{value + 1} of {steps.length}: {steps[value]?.log.nodeLabel}. Replay is visual-only and never reruns this execution.</p>
  </div>;
}

function VariableExplorer({ run }: { run: ExecutionRun | null }) {
  const selectNode = useUIStore((state) => state.selectNode);
  const selectedStepNodeId = useExecutionStore((state) => state.selectedStepNodeId);
  const setSelectedStepNodeId = useExecutionStore((state) => state.setSelectedStepNodeId);
  if (!run) return <InspectorEmpty message="Run a workflow or select a historical execution to explore its payloads." />;
  if (run.stepLogs.length === 0) return <InspectorEmpty message="This execution did not record payloads." />;
  return <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
    {buildTimelineSteps(run).map(({ log, executionOrder }) => {
      const selected = selectedStepNodeId === log.nodeId;
      const summary = log.nodeType === 'condition' ? `Condition result: ${String(log.output?.result ?? log.output?.condition ?? 'recorded')}` : `${log.nodeType.replace('_', ' ')} configuration-to-output transition`;
      return <section key={log.nodeId} className={cn('px-4 py-3 transition-colors', selected && 'bg-blue-50/60 dark:bg-blue-950/15')}>
        <button type="button" onClick={() => { setSelectedStepNodeId(log.nodeId); selectNode(log.nodeId); }} aria-expanded={selected} className="flex w-full items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
          <span className="text-[10px] tabular-nums text-zinc-400">{executionOrder + 1}</span><span className="min-w-0 flex-1 truncate text-xs font-semibold text-zinc-800 dark:text-zinc-100">{log.nodeLabel}</span><span className="text-[10px] capitalize text-zinc-400">{log.status}</span>
        </button>
        {selected && <div className="mt-3 space-y-3">
          <p className="text-[10px] text-violet-700 dark:text-violet-300">Transformation summary: {summary}</p>
          <div><p className="text-[10px] font-medium text-zinc-500">Recorded Configuration</p><SafeData value={log.input ?? {}} /><p className="mt-1 text-[10px] text-zinc-400">This run does not retain resolved incoming payloads.</p></div>
          <PayloadDiffSummary input={log.input} output={log.output} />
          <div><p className="text-[10px] font-medium text-zinc-500">Runtime Output</p><SafeData value={log.output ?? (log.error ? { error: log.error } : {})} /></div>
          <div className="rounded-md border border-zinc-200 px-2 py-1.5 text-[10px] dark:border-zinc-700"><p className="font-medium text-zinc-500">Execution</p><p className="mt-0.5 text-zinc-600 dark:text-zinc-300">{STATUS_STYLES[log.status].label} · {formatDuration(log.durationMs)}</p></div>
          {log.error && <div><p className="text-[10px] font-medium text-red-600 dark:text-red-400">Logs</p><SafeData value={log.error} /></div>}
        </div>}
      </section>;
    })}
  </div>;
}

function StepLogRow({ log }: { log: StepLog }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const style = STATUS_STYLES[log.status];
  const typeInfo = NODE_TYPE_REGISTRY[log.nodeType as keyof typeof NODE_TYPE_REGISTRY];
  const hasDetail = Boolean(log.input || log.output || log.error);

  return (
    <div className="border-b border-zinc-100 last:border-b-0 dark:border-zinc-800/50">
      <button
        type="button"
        onClick={() => setIsExpanded((expanded) => !expanded)}
        aria-expanded={isExpanded}
        className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-zinc-100/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 dark:hover:bg-zinc-800/30"
      >
        <span className={cn('h-2 w-2 shrink-0 rounded-full', style.dot)} aria-hidden="true" />
        <span className="text-[10px]" aria-hidden="true">{typeInfo?.icon}</span>
        <span className={cn(
          'min-w-0 flex-1 truncate text-xs font-medium',
          log.status === 'skipped' ? 'text-zinc-400 dark:text-zinc-500' : 'text-zinc-800 dark:text-zinc-200',
        )}>
          {log.nodeLabel}
        </span>
        <span className={cn('text-[10px] font-medium', style.text)}>{style.label}</span>
        {log.durationMs != null && <span className="text-[10px] tabular-nums text-zinc-400">{formatDuration(log.durationMs)}</span>}
        {hasDetail && <span className="text-[10px] text-zinc-400" aria-hidden="true">{isExpanded ? '▾' : '▸'}</span>}
      </button>

      {isExpanded && hasDetail && (
        <div className="space-y-2 border-t border-zinc-100 bg-zinc-50 px-4 py-2 dark:border-zinc-800/50 dark:bg-zinc-900/30">
          {log.input && (
            <div>
              <p className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">Recorded Configuration</p>
              <SafeData value={log.input} />
            </div>
          )}
          {log.error && (
            <div>
              <p className="text-[10px] font-medium text-red-600 dark:text-red-400">Error</p>
              {log.diagnostic ? <TransformDiagnosticDetails diagnostic={log.diagnostic} /> : <SafeData value={log.error} />}
            </div>
          )}
          {log.output && (
            <div>
              <p className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">Runtime Output</p>
              <ResponseMetadata output={log.output} durationMs={log.durationMs} />
              <SafeData value={log.output} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RunSummary({ run, now }: { run: ExecutionRun; now: number }) {
  const summary = getRunSummary(run, now);
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 px-4 py-3 text-[10px] sm:grid-cols-4">
      <div><dt className="text-zinc-400">Status</dt><dd className="font-medium capitalize text-zinc-800 dark:text-zinc-200">{run.status}</dd></div>
      <div><dt className="text-zinc-400">Trigger</dt><dd className="font-medium capitalize text-zinc-800 dark:text-zinc-200">{run.triggerType.replace('_', ' ')}</dd></div>
      <div><dt className="text-zinc-400">Total duration</dt><dd className="font-medium text-zinc-800 dark:text-zinc-200">{formatDuration(summary.totalDurationMs)}</dd></div>
      <div><dt className="text-zinc-400">Started</dt><dd className="font-medium text-zinc-800 dark:text-zinc-200">{formatDateTime(run.startedAt)}</dd></div>
      <div><dt className="text-zinc-400">Completed</dt><dd className="font-medium text-zinc-800 dark:text-zinc-200">{formatDateTime(run.completedAt)}</dd></div>
      <div><dt className="text-zinc-400">Successful</dt><dd className="font-medium text-emerald-700 dark:text-emerald-400">{summary.successfulSteps}</dd></div>
      <div><dt className="text-zinc-400">Failed / skipped</dt><dd className="font-medium text-zinc-800 dark:text-zinc-200">{summary.failedSteps} / {summary.skippedSteps}</dd></div>
      <div><dt className="text-zinc-400">Current node</dt><dd className="truncate font-medium text-zinc-800 dark:text-zinc-200">{summary.currentNode?.nodeLabel ?? '—'}</dd></div>
    </dl>
  );
}

function ExecutionInsights({ run, now }: { run: ExecutionRun; now: number }) {
  const summary = useMemo(() => getRunSummary(run, now), [run, now]);
  const payloadFacts = useMemo(() => run.stepLogs.map((log) => ({ log, size: getPayloadSize(log.output) })), [run]);
  const largest = payloadFacts.reduce<(typeof payloadFacts)[number] | null>((current, item) => !current || item.size > current.size ? item : current, null);
  const slowest = run.stepLogs.reduce<StepLog | null>((current, log) => !current || (log.durationMs ?? 0) > (current.durationMs ?? 0) ? log : current, null);
  const successRate = summary.totalSteps ? Math.round((summary.successfulSteps / summary.totalSteps) * 100) : 0;
  const facts = [
    ['Execution time', formatDuration(summary.totalDurationMs)],
    ['Executed nodes', String(summary.completedSteps)],
    ['Skipped nodes', String(summary.skippedSteps)],
    ['Payload size (preview)', `~${formatBytes(payloadFacts.reduce((total, item) => total + item.size, 0))}`],
    ['Largest node', largest ? `${largest.log.nodeLabel} (${formatBytes(largest.size)})` : '—'],
    ['Slowest node', slowest ? `${slowest.nodeLabel} (${formatDuration(slowest.durationMs)})` : '—'],
    ['Success rate', `${successRate}%`],
  ];
  return <section aria-label="Execution Insights" className="border-b border-zinc-100 bg-zinc-50/70 px-4 py-2.5 dark:border-zinc-800 dark:bg-zinc-900/20"><p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Execution Insights</p><dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4">{facts.map(([label, value]) => <div key={label}><dt className="text-[10px] text-zinc-400">{label}</dt><dd className="truncate text-[10px] font-medium text-zinc-700 dark:text-zinc-200" title={value}>{value}</dd></div>)}</dl></section>;
}

function TimelineView({ run, now }: { run: ExecutionRun | null; now: number }) {
  const selectNode = useUIStore((state) => state.selectNode);
  const selectedStepNodeId = useExecutionStore((state) => state.selectedStepNodeId);
  const setSelectedStepNodeId = useExecutionStore((state) => state.setSelectedStepNodeId);

  if (!run) {
    return <InspectorEmpty message="Run a workflow or select a historical execution to inspect its timeline." />;
  }

  const timelineSteps = buildTimelineSteps(run);
  const longestDuration = getLongestDuration(timelineSteps);

  if (timelineSteps.length === 0) {
    return <InspectorEmpty message="This execution did not record any steps." />;
  }

  return (
    <div>
      <RunSummary run={run} now={now} />
      <ExecutionInsights run={run} now={now} />
      <ReplayControl run={run} />
      <ol className="border-t border-zinc-100 dark:border-zinc-800">
        {timelineSteps.map(({ log, executionOrder }) => {
          const style = STATUS_STYLES[log.status];
          const barWidth = getDurationBarPercent(log.durationMs, longestDuration);
          const selected = selectedStepNodeId === log.nodeId;
          return (
            <li key={log.nodeId} className="border-b border-zinc-100 dark:border-zinc-800/50">
              <button
                type="button"
                onClick={() => {
                  setSelectedStepNodeId(log.nodeId);
                  selectNode(log.nodeId);
                }}
                aria-pressed={selected}
                className={cn(
                  'flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 dark:hover:bg-zinc-900/30',
                  selected && 'bg-blue-50 dark:bg-blue-950/20',
                )}
              >
                <span className="w-5 text-right font-mono text-[10px] text-zinc-400">{executionOrder + 1}</span>
                <span className={cn('h-2 w-2 shrink-0 rounded-full', style.dot)} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-zinc-800 dark:text-zinc-200">{log.nodeLabel}</span>
                  <span className="block text-[10px] text-zinc-400">{log.nodeType} · {formatDateTime(log.startedAt)}</span>
                </span>
                <span className="hidden w-32 sm:block" aria-label={`Duration ${formatDuration(log.durationMs)} relative to longest step`}>
                  <span className="block h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                    <span className={cn('block h-full rounded-full', style.dot)} style={{ width: `${barWidth}%`, minWidth: barWidth > 0 ? '3px' : undefined }} />
                  </span>
                </span>
                <span className={cn('w-14 text-right text-[10px] font-medium', style.text)}>{style.label}</span>
                <span className="w-12 text-right text-[10px] tabular-nums text-zinc-400">{formatDuration(log.durationMs)}</span>
              </button>
              {(log.error || log.status === 'skipped') && (
                <p className={cn('px-4 pb-2 pl-12 text-[10px]', log.error ? 'text-red-600 dark:text-red-400' : 'text-zinc-400')}>
                  {log.error ? redactInspectionValue(log.error) as string : 'Skipped by workflow branch selection.'}
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function InspectorEmpty({ message }: { message: string }) {
  return <div className="flex h-full min-h-40 items-center justify-center px-4 text-center text-xs text-zinc-400 dark:text-zinc-500">{message}</div>;
}

function LiveView({ run, lastError, now }: { run: ExecutionRun | null; lastError: string | null; now: number }) {
  if (!run) return <InspectorEmpty message={lastError || 'Click Run to execute the workflow.'} />;
  const summary = getRunSummary(run, now);
  return (
    <div>
      {run.status !== 'running' && (
        <div className={cn('mx-4 mt-3 flex items-center justify-between rounded-xl border px-4 py-3 transition-all duration-300', run.status === 'completed' ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900/50 dark:bg-emerald-950/20' : 'border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-950/20')}>
          <div><p className="text-xs font-semibold text-zinc-800 dark:text-zinc-100">{run.status === 'completed' ? 'Workflow completed' : `Workflow ${run.status}`}</p><p className="mt-0.5 text-[10px] text-zinc-500 dark:text-zinc-400">{summary.successfulSteps} successful / {summary.failedSteps} failed / {summary.skippedSteps} skipped</p></div>
          <span className="text-[10px] font-medium tabular-nums text-zinc-600 dark:text-zinc-300">{formatDuration(summary.totalDurationMs)}</span>
        </div>
      )}
      <RunSummary run={run} now={now} />
      <div className="border-t border-zinc-100 dark:border-zinc-800">
        {run.stepLogs.map((log) => <StepLogRow key={log.nodeId} log={log} />)}
      </div>
      {run.error && <p className="border-t border-red-100 bg-red-50 px-4 py-2 text-[10px] font-medium text-red-700 dark:border-red-900/30 dark:bg-red-950/20 dark:text-red-400">{redactInspectionValue(run.error) as string}</p>}
    </div>
  );
}

function HistoryView({ workflowId, now }: { workflowId?: string; now: number }) {
  const historyRuns = useExecutionStore((state) => state.historyRuns);
  const historyStatus = useExecutionStore((state) => state.historyStatus);
  const historyError = useExecutionStore((state) => state.historyError);
  const historyWorkflowId = useExecutionStore((state) => state.historyWorkflowId);
  const selectedHistoricalRunId = useExecutionStore((state) => state.selectedHistoricalRunId);
  const selectHistoricalRun = useExecutionStore((state) => state.selectHistoricalRun);
  const setActiveInspectorTab = useExecutionStore((state) => state.setActiveInspectorTab);
  const setHistoryLoading = useExecutionStore((state) => state.setHistoryLoading);
  const setHistory = useExecutionStore((state) => state.setHistory);
  const setHistoryError = useExecutionStore((state) => state.setHistoryError);
  const clearHistory = useExecutionStore((state) => state.clearHistory);
  const requestInFlightForWorkflow = useRef<string | null>(null);
  const latestRequest = useRef(0);

  const loadHistory = useCallback(async (force = false) => {
    if (!workflowId || requestInFlightForWorkflow.current === workflowId) return;
    if (!force && historyWorkflowId === workflowId && (historyStatus === 'idle' || historyStatus === 'error')) return;
    const requestId = ++latestRequest.current;
    requestInFlightForWorkflow.current = workflowId;
    setHistoryLoading(workflowId);
    try {
      const runs = await api.listExecutions(workflowId);
      if (requestId === latestRequest.current) setHistory(workflowId, runs);
    } catch (error) {
      if (requestId === latestRequest.current) {
        setHistoryError(workflowId, api.getApiErrorMessage(error, 'Unable to load execution history. Please try again.'));
      }
    } finally {
      if (requestId === latestRequest.current) requestInFlightForWorkflow.current = null;
    }
  }, [workflowId, historyWorkflowId, historyStatus, setHistoryLoading, setHistory, setHistoryError]);

  useEffect(() => {
    if (workflowId) {
      void loadHistory();
    } else {
      clearHistory();
    }
  }, [workflowId, loadHistory, clearHistory]);

  if (!workflowId) return <InspectorEmpty message="Save this workflow before viewing execution history." />;

  if (historyStatus === 'loading' && historyRuns.length === 0) {
    return <div className="space-y-2 px-4 py-3" aria-label="Loading execution history">{[1, 2, 3].map((item) => <div key={item} className="h-10 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />)}</div>;
  }

  if (historyStatus === 'error') {
    return (
      <div className="flex min-h-40 flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="text-xs text-red-600 dark:text-red-400">{historyError}</p>
        <button type="button" onClick={() => void loadHistory(true)} className="rounded-md border border-zinc-300 px-3 py-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-zinc-700">Retry</button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-2 dark:border-zinc-800">
        <p className="text-[10px] text-zinc-400">Newest 20 executions</p>
        <button type="button" onClick={() => void loadHistory(true)} disabled={historyStatus === 'loading'} className="text-xs font-medium text-zinc-700 hover:underline disabled:opacity-50 dark:text-zinc-300">Refresh</button>
      </div>
      {historyRuns.length === 0 ? (
        <InspectorEmpty message="No executions have been recorded for this workflow." />
      ) : (
        <ul>
          {historyRuns.map((run) => {
            const summary = getRunSummary(run, now);
            const selected = selectedHistoricalRunId === run._id;
            return (
              <li key={run._id} className="border-b border-zinc-100 dark:border-zinc-800/50">
                <button
                  type="button"
                  onClick={() => {
                    selectHistoricalRun(run._id);
                    setActiveInspectorTab('timeline');
                  }}
                  className={cn('grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-2.5 text-left hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 dark:hover:bg-zinc-900/30', selected && 'bg-blue-50 dark:bg-blue-950/20')}
                >
                  <span className={cn('h-2 w-2 rounded-full', RUN_STATUS_BADGE[run.status]?.split(' ')[0] || 'bg-zinc-400')} aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block text-xs font-medium capitalize text-zinc-800 dark:text-zinc-200">{run.status} · {run.triggerType.replace('_', ' ')}</span>
                    <span className="block truncate text-[10px] text-zinc-400">{formatDateTime(run.startedAt)} · {summary.successfulSteps} successful, {summary.failedSteps} failed, {summary.skippedSteps} skipped</span>
                  </span>
                  <span className="text-right text-[10px] tabular-nums text-zinc-400">{formatDuration(summary.totalDurationMs)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function ExecutionPanel() {
  const isOpen = useUIStore((state) => state.isExecutionPanelOpen);
  const setExecutionPanelOpen = useUIStore((state) => state.setExecutionPanelOpen);
  const isMaximized = useUIStore((state) => state.isExecutionInspectorMaximized);
  const maximizeExecutionInspector = useUIStore((state) => state.maximizeExecutionInspector);
  const restoreExecutionInspector = useUIStore((state) => state.restoreExecutionInspector);
  const workflowId = useWorkflowStore((state) => state.meta?._id);
  const currentRun = useExecutionStore((state) => state.currentRun);
  const lastError = useExecutionStore((state) => state.lastError);
  const historyRuns = useExecutionStore((state) => state.historyRuns);
  const selectedHistoricalRunId = useExecutionStore((state) => state.selectedHistoricalRunId);
  const activeInspectorTab = useExecutionStore((state) => state.activeInspectorTab);
  const setActiveInspectorTab = useExecutionStore((state) => state.setActiveInspectorTab);
  const [now, setNow] = useState(() => Date.now());
  const [height, setHeight] = useState(288);
  const dragStart = useRef<{ y: number; height: number } | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const tabRefs = useRef<Record<InspectorTab, HTMLButtonElement | null>>({ live: null, timeline: null, history: null, variables: null });

  const getBounds = useCallback(() => {
    const measuredHeight = panelRef.current?.parentElement?.getBoundingClientRect().height ?? 0;
    const availableHeight = measuredHeight > 0
      ? measuredHeight
      : (typeof window === 'undefined' ? 680 : Math.max(400, window.innerHeight - 120));
    const min = Math.min(220, Math.max(160, Math.round(availableHeight * 0.2)));
    const max = Math.max(min, Math.min(Math.round(availableHeight * 0.82), availableHeight - 160));
    return { min, max, preferred: Math.max(min, Math.min(max, Math.round(availableHeight * 0.28))) };
  }, []);
  const applyHeight = useCallback((nextHeight: number, persist = false) => {
    const { min, max } = getBounds();
    const clamped = Math.round(Math.max(min, Math.min(max, nextHeight)));
    setHeight(clamped);
    if (persist) window.localStorage.setItem('flowcraft.executionInspector.height', String(clamped));
  }, [getBounds]);

  useEffect(() => {
    const stored = Number(window.localStorage.getItem('flowcraft.executionInspector.height'));
    const { min, max, preferred } = getBounds();
    setHeight(Number.isFinite(stored) && stored >= min && stored <= max ? stored : preferred);
  }, [getBounds]);
  useEffect(() => {
    if (!isMaximized) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') restoreExecutionInspector(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isMaximized, restoreExecutionInspector]);

  useEffect(() => {
    if (currentRun?.status !== 'running') return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [currentRun?.status]);

  const selectedHistoricalRun = historyRuns.find((run) => run._id === selectedHistoricalRunId) ?? null;
  const timelineRun = selectedHistoricalRun ?? currentRun;
  const currentSummary = currentRun ? getRunSummary(currentRun, now) : null;

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const nextTab = getNextInspectorTab(activeInspectorTab, event.key);
    if (!nextTab) return;
    event.preventDefault();
    setActiveInspectorTab(nextTab);
    tabRefs.current[nextTab]?.focus();
  };

  const beginResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isOpen || isMaximized) return;
    dragStart.current = { y: event.clientY, height };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    document.body.classList.add('select-none');
  };
  const resize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStart.current) return;
    applyHeight(dragStart.current.height - (event.clientY - dragStart.current.y));
    window.dispatchEvent(new Event('resize'));
  };
  const finishResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStart.current) return;
    const finalHeight = dragStart.current.height - (event.clientY - dragStart.current.y);
    dragStart.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    document.body.classList.remove('select-none');
    applyHeight(finalHeight, true);
  };
  const resizeByKeyboard = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowUp') { event.preventDefault(); applyHeight(height + 32, true); }
    if (event.key === 'ArrowDown') { event.preventDefault(); applyHeight(height - 32, true); }
    if (event.key === 'Home') { event.preventDefault(); setExecutionPanelOpen(false); }
    if (event.key === 'End') { event.preventDefault(); maximizeExecutionInspector(); }
  };

  return (
    <section ref={panelRef} className={cn('flex shrink-0 flex-col border-t border-zinc-200 bg-white transition-[height] duration-200 dark:border-zinc-800 dark:bg-zinc-950', isMaximized && 'min-h-0 flex-1')} style={!isMaximized && isOpen ? { height } : undefined} aria-label="Execution Inspector">
      {isOpen && !isMaximized && <div role="slider" tabIndex={0} aria-label="Resize execution inspector" aria-valuemin={getBounds().min} aria-valuemax={getBounds().max} aria-valuenow={height} onPointerDown={beginResize} onPointerMove={resize} onPointerUp={finishResize} onPointerCancel={finishResize} onKeyDown={resizeByKeyboard} onDoubleClick={() => applyHeight(288, true)} className="group flex h-3 shrink-0 cursor-row-resize items-center justify-center touch-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"><span className="h-1 w-14 rounded-full bg-zinc-300 transition-colors group-hover:bg-violet-400 dark:bg-zinc-700 dark:group-hover:bg-violet-500" /></div>}
      <button
        type="button"
        onClick={() => setExecutionPanelOpen(!isOpen)}
        className="flex w-full items-center justify-between bg-white px-4 py-2 text-left transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 dark:bg-zinc-950 dark:hover:bg-zinc-900"
        aria-expanded={isOpen}
      >
        <span className="flex items-center gap-2">
          <span className="text-[10px]" aria-hidden="true">{isOpen ? '▾' : '▴'}</span>
          <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Execution Inspector</span>
          {currentRun && <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-medium', RUN_STATUS_BADGE[currentRun.status] || RUN_STATUS_BADGE.cancelled)}>{currentRun.status}</span>}
          {currentSummary && <span className="text-[10px] text-zinc-400">{currentSummary.completedSteps}/{currentSummary.totalSteps} steps</span>}
        </span>
      </button>

      <div className="sticky top-0 z-20 flex justify-end gap-1 border-b border-zinc-100 bg-white/95 px-3 py-1 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
        {isOpen && <button type="button" onClick={() => setExecutionPanelOpen(false)} className="rounded px-2 py-1 text-[10px] font-medium text-zinc-500 hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:bg-zinc-800" aria-label="Collapse execution inspector">Collapse</button>}
        {!isOpen && <button type="button" onClick={() => setExecutionPanelOpen(true)} className="rounded px-2 py-1 text-[10px] font-medium text-zinc-500 hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:bg-zinc-800" aria-label="Restore execution inspector">Restore</button>}
        {isOpen && (isMaximized ? <button type="button" onClick={restoreExecutionInspector} className="rounded px-2 py-1 text-[10px] font-medium text-zinc-500 hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:bg-zinc-800" aria-label="Restore execution inspector">Restore</button> : <button type="button" onClick={maximizeExecutionInspector} className="rounded px-2 py-1 text-[10px] font-medium text-zinc-500 hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:bg-zinc-800" aria-label="Maximize execution inspector">Maximize</button>)}
      </div>

      {isOpen && (
        <div className="flex min-h-0 flex-1 flex-col bg-white dark:bg-zinc-950">
          <div className="sticky top-0 z-10 border-b border-zinc-100 bg-white px-4 dark:border-zinc-800 dark:bg-zinc-950" role="tablist" aria-label="Execution Inspector views">
            <div className="flex gap-4">
              {INSPECTOR_TABS.map((tab) => (
                <button
                  key={tab}
                  ref={(element) => { tabRefs.current[tab] = element; }}
                  id={`execution-inspector-tab-${tab}`}
                  role="tab"
                  type="button"
                  aria-selected={activeInspectorTab === tab}
                  aria-controls={`execution-inspector-panel-${tab}`}
                  tabIndex={activeInspectorTab === tab ? 0 : -1}
                  onKeyDown={handleTabKeyDown}
                  onClick={() => setActiveInspectorTab(tab)}
                  className={cn('border-b-2 py-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500', activeInspectorTab === tab ? 'border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100' : 'border-transparent text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300')}
                >
                  {TAB_LABELS[tab]}
                </button>
              ))}
            </div>
          </div>
          <div id={`execution-inspector-panel-${activeInspectorTab}`} role="tabpanel" aria-labelledby={`execution-inspector-tab-${activeInspectorTab}`} onWheel={(event) => event.stopPropagation()} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {activeInspectorTab === 'live' && <LiveView run={currentRun} lastError={lastError} now={now} />}
            {activeInspectorTab === 'timeline' && <TimelineView run={timelineRun} now={now} />}
            {activeInspectorTab === 'history' && <HistoryView workflowId={workflowId} now={now} />}
            {activeInspectorTab === 'variables' && <VariableExplorer run={timelineRun} />}
          </div>
        </div>
      )}
    </section>
  );
}
