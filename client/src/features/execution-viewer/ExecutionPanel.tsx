'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useUIStore } from '@/stores/uiStore';
import { useWorkflowStore } from '@/stores/workflowStore';
import { useExecutionStore } from '@/stores/executionStore';
import { NODE_TYPE_REGISTRY } from '@/lib/constants';
import * as api from '@/lib/api';
import { cn } from '@/lib/utils';
import type { ExecutionRun, StepLog, StepStatus } from '@/types';
import {
  INSPECTOR_TABS,
  type InspectorTab,
  buildTimelineSteps,
  formatDateTime,
  formatDuration,
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
};

function SafeData({ value }: { value: unknown }) {
  return (
    <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-zinc-600 dark:text-zinc-400">
      {JSON.stringify(redactInspectionValue(value), null, 2)}
    </pre>
  );
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
              <SafeData value={log.error} />
            </div>
          )}
          {log.output && (
            <div>
              <p className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">Output</p>
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
  return (
    <div>
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
  const togglePanel = useUIStore((state) => state.toggleExecutionPanel);
  const workflowId = useWorkflowStore((state) => state.meta?._id);
  const currentRun = useExecutionStore((state) => state.currentRun);
  const lastError = useExecutionStore((state) => state.lastError);
  const historyRuns = useExecutionStore((state) => state.historyRuns);
  const selectedHistoricalRunId = useExecutionStore((state) => state.selectedHistoricalRunId);
  const activeInspectorTab = useExecutionStore((state) => state.activeInspectorTab);
  const setActiveInspectorTab = useExecutionStore((state) => state.setActiveInspectorTab);
  const [now, setNow] = useState(() => Date.now());
  const tabRefs = useRef<Record<InspectorTab, HTMLButtonElement | null>>({ live: null, timeline: null, history: null });

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

  return (
    <section className="border-t border-zinc-200 dark:border-zinc-800" aria-label="Execution Inspector">
      <button
        type="button"
        onClick={togglePanel}
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

      {isOpen && (
        <div className="h-72 overflow-y-auto bg-white dark:bg-zinc-950">
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
          <div id={`execution-inspector-panel-${activeInspectorTab}`} role="tabpanel" aria-labelledby={`execution-inspector-tab-${activeInspectorTab}`}>
            {activeInspectorTab === 'live' && <LiveView run={currentRun} lastError={lastError} now={now} />}
            {activeInspectorTab === 'timeline' && <TimelineView run={timelineRun} now={now} />}
            {activeInspectorTab === 'history' && <HistoryView workflowId={workflowId} now={now} />}
          </div>
        </div>
      )}
    </section>
  );
}
