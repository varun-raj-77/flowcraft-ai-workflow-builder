'use client';

import React, { useMemo } from 'react';
import { useExecutionStore } from '@/stores/executionStore';
import { useUIStore } from '@/stores/uiStore';
import type { ExecutionRun, ExecutionHistorySummaryRun } from '@/types';
import { diagnoseRun, compareExecutionRuns } from './executionDebugging';
import { formatDuration } from './executionInspector';

export function ExecutionDiagnosis({ run }: { run: ExecutionRun }) {
  const diagnosis = useMemo(() => diagnoseRun(run), [run]);
  const selectNode = useUIStore((state) => state.selectNode);
  const selectStep = useExecutionStore((state) => state.setSelectedStepNodeId);
  if (diagnosis.kind === 'success' || diagnosis.kind === 'running') return null;
  return <section aria-label="Execution diagnosis" className="border-b border-[var(--border-subtle)] bg-amber-500/5 px-4 py-3 text-[11px]">
    <h3 className="font-semibold text-[var(--text-primary)]">{diagnosis.title}</h3>
    <p className="mt-1 text-[var(--text-secondary)]">{diagnosis.description}</p>
    <p className="mt-1 text-[var(--text-muted)]"><strong>Suggested next step:</strong> {diagnosis.nextAction}</p>
    {diagnosis.failedNodeId && <button type="button" onClick={() => {
      selectStep(diagnosis.failedNodeId);
      selectNode(diagnosis.failedNodeId);
      useExecutionStore.getState().setActiveInspectorTab('timeline');
    }} className="mt-2 rounded border border-amber-500/40 px-2 py-1 font-semibold text-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:text-amber-300">Inspect failed step</button>}
    <p className="mt-1 text-[10px] text-[var(--text-muted)]">Guidance is based on recorded status and node type, not an independently verified root cause.</p>
  </section>;
}

export function RunComparisonPanel({ baseline, candidate, onClear }: {
  baseline: ExecutionHistorySummaryRun; candidate: ExecutionHistorySummaryRun; onClear: () => void;
}) {
  const report = useMemo(() => compareExecutionRuns(baseline, candidate), [baseline, candidate]);
  return <section aria-label="Run comparison" className="border-b border-[var(--border-subtle)] bg-violet-500/5 px-4 py-3 text-xs text-[var(--text-secondary)]">
    <div className="flex items-center justify-between gap-2">
      <h3 className="font-semibold text-[var(--text-primary)]">Compare executions</h3>
      <button type="button" onClick={onClear} className="rounded border border-[var(--border-default)] px-2 py-1 text-[10px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500">Clear comparison</button>
    </div>
    <p className="mt-2 text-[10px] text-[var(--text-muted)]">Baseline ({baseline.status}) → Selected ({candidate.status})</p>
    <dl className="mt-2 grid grid-cols-2 gap-3">
      <div><dt className="text-[10px]">Status</dt><dd className="font-semibold">{report.statusChanged ? 'Changed' : 'Unchanged'}</dd></div>
      <div><dt className="text-[10px]">Duration change</dt><dd className="font-semibold">{report.durationDifferenceMs === null ? 'Unavailable' : `${report.durationDifferenceMs >= 0 ? '+' : '−'}${formatDuration(Math.abs(report.durationDifferenceMs))}`}</dd></div>
      <div><dt className="text-[10px]">Successful steps Δ</dt><dd className="font-semibold">{report.successCountDifference >= 0 ? '+' : ''}{report.successCountDifference}</dd></div>
      <div><dt className="text-[10px]">Skipped steps Δ</dt><dd className="font-semibold">{report.skippedCountDifference >= 0 ? '+' : ''}{report.skippedCountDifference}</dd></div>
    </dl>
    <p className="mt-3 text-[10px] text-[var(--text-muted)]">{report.note}</p>
    {report.comparableSteps && <div className="mt-2 max-h-48 overflow-auto">
      <table aria-label="Compared node states" className="w-full text-left text-[10px]">
        <thead><tr><th scope="col" className="py-1">Node</th><th scope="col">Before</th><th scope="col">After</th><th scope="col">Time Δ</th></tr></thead>
        <tbody>{report.steps.map((step) => {
          const delta = step.beforeDurationMs === null || step.afterDurationMs === null
            ? '—' : `${step.afterDurationMs - step.beforeDurationMs >= 0 ? '+' : '−'}${formatDuration(Math.abs(step.afterDurationMs - step.beforeDurationMs))}`;
          return <tr key={step.nodeId} className={step.statusChanged ? 'bg-amber-500/10' : ''}>
            <td className="py-1 capitalize">{step.nodeType.replaceAll('_', ' ')}</td>
            <td>{step.before}</td><td>{step.after}</td><td>{delta}</td>
          </tr>;
        })}</tbody>
      </table>
      {report.limited && <p className="mt-1 text-amber-600">Only the first 100 nodes are shown.</p>}
    </div>}
  </section>;
}
