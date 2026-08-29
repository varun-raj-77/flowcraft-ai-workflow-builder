import { memo } from 'react';
import { Handle, Position, useNodeId } from '@xyflow/react';
import { cn } from '@/lib/utils';
import { NODE_TYPE_REGISTRY } from '@/lib/constants';
import { useUIStore } from '@/stores/uiStore';
import { useExecutionStore } from '@/stores/executionStore';
import { useRevisionComparisonStore } from '@/stores/revisionComparisonStore';
import type { NodeType, StepStatus } from '@/types';

/**
 * Node type accents stay subdued so selection, execution, and comparison states
 * remain legible when they are composed on the same card.
 */
const ACCENT_COLORS: Record<string, { bg: string; border: string; ring: string; icon: string }> = {
  emerald: {
    bg: 'bg-emerald-500/10', border: 'border-emerald-500/50', ring: 'ring-emerald-400/25', icon: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300',
  },
  sky: {
    bg: 'bg-sky-500/10', border: 'border-sky-500/50', ring: 'ring-sky-400/25', icon: 'border-sky-500/20 bg-sky-500/10 text-sky-300',
  },
  amber: {
    bg: 'bg-amber-500/10', border: 'border-amber-500/50', ring: 'ring-amber-400/25', icon: 'border-amber-500/20 bg-amber-500/10 text-amber-300',
  },
  violet: {
    bg: 'bg-violet-500/10', border: 'border-violet-500/50', ring: 'ring-violet-400/25', icon: 'border-violet-500/20 bg-violet-500/10 text-violet-300',
  },
  teal: {
    bg: 'bg-teal-500/10', border: 'border-teal-500/50', ring: 'ring-teal-400/25', icon: 'border-teal-500/20 bg-teal-500/10 text-teal-300',
  },
  rose: {
    bg: 'bg-rose-500/10', border: 'border-rose-500/50', ring: 'ring-rose-400/25', icon: 'border-rose-500/20 bg-rose-500/10 text-rose-300',
  },
  zinc: {
    bg: 'bg-zinc-500/10', border: 'border-zinc-500/50', ring: 'ring-zinc-400/25', icon: 'border-zinc-500/20 bg-zinc-500/10 text-zinc-300',
  },
};

interface BaseNodeProps {
  nodeType: NodeType;
  label: string;
  subtitle?: string;
  /** Custom handles — if provided, BaseNode won't render default handles */
  children?: React.ReactNode;
  /** Hide the default input handle (e.g. for Start node) */
  hideInput?: boolean;
  /** Hide the default output handle (e.g. for End node) */
  hideOutput?: boolean;
}

export const BaseNode = memo(function BaseNode({
  nodeType,
  label,
  subtitle,
  children,
  hideInput = false,
  hideOutput = false,
}: BaseNodeProps) {
  const nodeId = useNodeId();
  const selectedNodeId = useUIStore((s) => s.selectedNodeId);
  const isSelected = nodeId === selectedNodeId;
  const comparisonStatus = useRevisionComparisonStore((state) => {
    if (!state.comparison || !nodeId) return undefined;
    if (state.comparison.nodes.added.some((item) => item.nodeId === nodeId)) return 'added' as const;
    if (state.comparison.nodes.removed.some((item) => item.nodeId === nodeId)) return 'removed' as const;
    const modified = state.comparison.nodes.modified.find((item) => item.nodeId === nodeId);
    if (!modified) return 'unchanged' as const;
    return modified.changes.every((change) => change.category === 'layout')
      ? 'layout' as const
      : 'modified' as const;
  });

  // Execution status — select only the primitive status string to avoid
  // re-rendering all nodes when any step log changes (code review fix #7)
  const execStatus = useExecutionStore((s) =>
    s.currentRun?.stepLogs.find((l) => l.nodeId === nodeId)?.status as StepStatus | undefined,
  );
  const replayRunId = useExecutionStore((s) => s.replayRunId);
  const replayStepIndex = useExecutionStore((s) => s.replayStepIndex);
  const replayRun = useExecutionStore((s) => {
    if (!s.replayRunId) return null;
    return s.currentRun?._id === s.replayRunId
      ? s.currentRun
      : s.historyRuns.find((run) => run._id === s.replayRunId) ?? null;
  });
  const replayPosition = replayRun && nodeId ? replayRun.executionOrder.indexOf(nodeId) : -1;
  const executionVisualStatus: StepStatus | undefined = replayRunId && replayRun && replayStepIndex !== null && replayPosition >= 0
    ? (replayPosition < replayStepIndex ? 'success' : replayPosition === replayStepIndex ? 'running' : 'pending')
    : execStatus;
  const visualStatus = comparisonStatus ? undefined : executionVisualStatus;

  const typeInfo = NODE_TYPE_REGISTRY[nodeType];
  const colors = ACCENT_COLORS[typeInfo.color] ?? ACCENT_COLORS.zinc;

  return (
    <div
      className={cn(
        'relative min-w-[176px] max-w-[228px] rounded-xl border bg-[var(--surface-raised)] shadow-lg shadow-black/20 transition-[border-color,box-shadow,opacity] duration-150',
        isSelected
          ? `${colors.border} ring-2 ${colors.ring} shadow-md`
          : 'border-[var(--border-subtle)] hover:border-[var(--border-default)] hover:shadow-xl',
        visualStatus === 'running' && 'animate-node-running ring-2 ring-blue-400/50',
        visualStatus === 'success' && 'animate-node-complete ring-2 ring-emerald-400/30',
        visualStatus === 'failed' && 'ring-2 ring-red-400/50',
        replayRunId && visualStatus === 'pending' && 'opacity-45 grayscale',
        comparisonStatus === 'added' && 'border-emerald-500 ring-1 ring-emerald-400/30',
        comparisonStatus === 'modified' && 'border-amber-500 ring-1 ring-amber-400/30',
        comparisonStatus === 'layout' && 'border-sky-500 ring-1 ring-sky-400/30',
        comparisonStatus === 'removed' && 'border-dashed border-red-500 opacity-65 ring-1 ring-red-400/25 grayscale',
      )}
    >
      {/* Left accent bar */}
      <div className={cn('absolute left-0 top-0 bottom-0 w-1 rounded-l-lg', colors.border, 'bg-current')} 
           style={{ color: 'transparent', borderLeftWidth: '3px' }} />

      {/* Execution status indicator (top-right corner) */}
      {visualStatus && visualStatus !== 'pending' && (
        <div className="absolute -right-1.5 -top-1.5 z-10">
          {visualStatus === 'running' && (
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 shadow-sm">
              <span className="h-2 w-2 animate-spin rounded-full border border-white border-t-transparent" />
            </span>
          )}
          {visualStatus === 'success' && (
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-[8px] text-white shadow-sm">
              ✓
            </span>
          )}
          {visualStatus === 'failed' && (
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[8px] text-white shadow-sm">
              ✕
            </span>
          )}
          {visualStatus === 'skipped' && (
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-zinc-400 text-[8px] text-white shadow-sm">
              –
            </span>
          )}
        </div>
      )}

      {comparisonStatus && comparisonStatus !== 'unchanged' && (
        <span className={cn(
          'absolute -top-5 left-0 rounded-t-md border border-b-0 bg-[var(--surface-overlay)] px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.12em] shadow-sm',
          comparisonStatus === 'added' && 'border-emerald-500/50 text-emerald-300',
          comparisonStatus === 'modified' && 'border-amber-500/50 text-amber-300',
          comparisonStatus === 'layout' && 'border-sky-500/50 text-sky-300',
          comparisonStatus === 'removed' && 'border-red-500/50 text-red-300',
        )}>
          {comparisonStatus === 'layout' ? 'Moved' : comparisonStatus}
        </span>
      )}

      {/* Content */}
      <div className="flex items-center gap-2.5 px-3 py-3 pl-4">
        <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-md border text-xs', colors.icon)}>
          {typeInfo.icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">{typeInfo.label} node</p>
          <p className="mt-0.5 truncate text-xs font-semibold text-[var(--text-primary)]">
            {label}
          </p>
          {subtitle && (
            <p className="mt-0.5 truncate font-mono text-[9px] text-[var(--text-muted)]">
              {subtitle}
            </p>
          )}
        </div>
      </div>

      {/* Default handles (unless custom children are provided) */}
      {!children && (
        <>
          {!hideInput && (
            <Handle
              type="target"
              position={Position.Left}
              className="!h-3 !w-3 !rounded-full !border-2 !border-[var(--border-active)] !bg-[var(--surface-overlay)]"
            />
          )}
          {!hideOutput && (
            <Handle
              type="source"
              position={Position.Right}
              className="!h-3 !w-3 !rounded-full !border-2 !border-[var(--border-active)] !bg-[var(--surface-overlay)]"
            />
          )}
        </>
      )}

      {/* Custom handles for condition nodes etc. */}
      {children}
    </div>
  );
});
