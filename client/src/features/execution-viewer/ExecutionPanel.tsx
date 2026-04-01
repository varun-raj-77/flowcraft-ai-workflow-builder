'use client';

import { useState } from 'react';
import { useUIStore } from '@/stores/uiStore';
import { useExecutionStore } from '@/stores/executionStore';
import { NODE_TYPE_REGISTRY } from '@/lib/constants';
import { cn } from '@/lib/utils';
import type { StepLog, StepStatus } from '@/types';

// ── Status styling ──────────────────────────────────────────

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

// ── Step log row ────────────────────────────────────────────

function StepLogRow({ log }: { log: StepLog }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const style = STATUS_STYLES[log.status];
  const typeInfo = NODE_TYPE_REGISTRY[log.nodeType as keyof typeof NODE_TYPE_REGISTRY];

  return (
    <div className="border-b border-zinc-100 last:border-b-0 dark:border-zinc-800/50">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-zinc-100/50 dark:hover:bg-zinc-800/30"
      >
        {/* Status dot */}
        <span className={cn('h-2 w-2 shrink-0 rounded-full', style.dot)} />

        {/* Icon + label */}
        <span className="text-[10px]">{typeInfo?.icon}</span>
        <span className={cn(
          'min-w-0 flex-1 truncate text-xs font-medium',
          log.status === 'skipped' ? 'text-zinc-400 dark:text-zinc-500' : 'text-zinc-800 dark:text-zinc-200',
        )}>
          {log.nodeLabel}
        </span>

        {/* Status + duration */}
        <span className={cn('text-[10px] font-medium', style.text)}>
          {style.label}
        </span>
        {log.durationMs != null && (
          <span className="text-[10px] tabular-nums text-zinc-400 dark:text-zinc-500">
            {log.durationMs}ms
          </span>
        )}

        {/* Expand indicator */}
        {(log.output || log.error) && (
          <span className="text-[10px] text-zinc-400">{isExpanded ? '▾' : '▸'}</span>
        )}
      </button>

      {/* Expanded detail */}
      {isExpanded && (log.output || log.error) && (
        <div className="border-t border-zinc-100 bg-zinc-50 px-4 py-2 dark:border-zinc-800/50 dark:bg-zinc-900/30">
          {log.error && (
            <div className="mb-2">
              <p className="text-[10px] font-medium text-red-600 dark:text-red-400">Error</p>
              <pre className="mt-1 whitespace-pre-wrap font-mono text-[10px] text-red-700 dark:text-red-300">
                {log.error}
              </pre>
            </div>
          )}
          {log.output && (
            <div>
              <p className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">Output</p>
              <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-zinc-600 dark:text-zinc-400">
                {JSON.stringify(log.output, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main panel ──────────────────────────────────────────────

export function ExecutionPanel() {
  const isOpen = useUIStore((s) => s.isExecutionPanelOpen);
  const togglePanel = useUIStore((s) => s.toggleExecutionPanel);
  const currentRun = useExecutionStore((s) => s.currentRun);

  return (
    <div className="border-t border-zinc-200 dark:border-zinc-800">
      {/* Toggle bar */}
      <button
        onClick={togglePanel}
        className="flex w-full items-center justify-between bg-white px-4 py-2 transition-colors hover:bg-zinc-50 dark:bg-zinc-950 dark:hover:bg-zinc-900"
      >
        <div className="flex items-center gap-2">
          <span className="text-[10px]">{isOpen ? '▾' : '▴'}</span>
          <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
            Execution Log
          </span>
          {currentRun && (
            <span className={cn(
              'rounded-full px-1.5 py-0.5 text-[10px] font-medium',
              RUN_STATUS_BADGE[currentRun.status] || RUN_STATUS_BADGE.cancelled,
            )}>
              {currentRun.status}
            </span>
          )}
          {currentRun?.stepLogs && (
            <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
              {currentRun.stepLogs.filter((l) => l.status === 'success').length}/
              {currentRun.stepLogs.length} nodes
            </span>
          )}
        </div>
      </button>

      {/* Expandable body */}
      {isOpen && (
        <div className="h-56 overflow-y-auto bg-white dark:bg-zinc-950">
          {!currentRun ? (
            <div className="flex h-full items-center justify-center">
              <p className="text-xs text-zinc-400 dark:text-zinc-500">
                Click Run to execute the workflow.
              </p>
            </div>
          ) : (
            <div>
              {currentRun.stepLogs.map((log) => (
                <StepLogRow key={log.nodeId} log={log} />
              ))}

              {/* Run-level error */}
              {currentRun.error && (
                <div className="border-t border-red-100 bg-red-50 px-4 py-2 dark:border-red-900/30 dark:bg-red-950/20">
                  <p className="text-[10px] font-medium text-red-700 dark:text-red-400">
                    {currentRun.error}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
