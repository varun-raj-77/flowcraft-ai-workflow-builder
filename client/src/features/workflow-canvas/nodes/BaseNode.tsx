import { memo } from 'react';
import { Handle, Position, useNodeId } from '@xyflow/react';
import { cn } from '@/lib/utils';
import { NODE_TYPE_REGISTRY } from '@/lib/constants';
import { useUIStore } from '@/stores/uiStore';
import { useExecutionStore } from '@/stores/executionStore';
import type { NodeType, StepStatus } from '@/types';

/**
 * Color mapping — maps the color name from NODE_TYPE_REGISTRY to actual Tailwind classes.
 * We need explicit classes because Tailwind can't resolve dynamic class names like `bg-${color}-500`.
 */
const ACCENT_COLORS: Record<string, { bg: string; border: string; ring: string; icon: string }> = {
  emerald: {
    bg: 'bg-emerald-50 dark:bg-emerald-950/30',
    border: 'border-emerald-400 dark:border-emerald-600',
    ring: 'ring-emerald-400/40',
    icon: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400',
  },
  sky: {
    bg: 'bg-sky-50 dark:bg-sky-950/30',
    border: 'border-sky-400 dark:border-sky-600',
    ring: 'ring-sky-400/40',
    icon: 'bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-400',
  },
  amber: {
    bg: 'bg-amber-50 dark:bg-amber-950/30',
    border: 'border-amber-400 dark:border-amber-600',
    ring: 'ring-amber-400/40',
    icon: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-400',
  },
  violet: {
    bg: 'bg-violet-50 dark:bg-violet-950/30',
    border: 'border-violet-400 dark:border-violet-600',
    ring: 'ring-violet-400/40',
    icon: 'bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-400',
  },
  teal: {
    bg: 'bg-teal-50 dark:bg-teal-950/30',
    border: 'border-teal-400 dark:border-teal-600',
    ring: 'ring-teal-400/40',
    icon: 'bg-teal-100 text-teal-700 dark:bg-teal-900/50 dark:text-teal-400',
  },
  rose: {
    bg: 'bg-rose-50 dark:bg-rose-950/30',
    border: 'border-rose-400 dark:border-rose-600',
    ring: 'ring-rose-400/40',
    icon: 'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-400',
  },
  zinc: {
    bg: 'bg-zinc-50 dark:bg-zinc-900/50',
    border: 'border-zinc-400 dark:border-zinc-600',
    ring: 'ring-zinc-400/40',
    icon: 'bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
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

  // Execution status — select only the primitive status string to avoid
  // re-rendering all nodes when any step log changes (code review fix #7)
  const execStatus = useExecutionStore((s) =>
    s.currentRun?.stepLogs.find((l) => l.nodeId === nodeId)?.status as StepStatus | undefined,
  );

  const typeInfo = NODE_TYPE_REGISTRY[nodeType];
  const colors = ACCENT_COLORS[typeInfo.color] ?? ACCENT_COLORS.zinc;

  return (
    <div
      className={cn(
        'relative min-w-[160px] max-w-[220px] rounded-lg border bg-white shadow-sm transition-shadow dark:bg-zinc-900',
        isSelected
          ? `${colors.border} ring-2 ${colors.ring} shadow-md`
          : 'border-zinc-200 dark:border-zinc-700 hover:shadow-md',
        execStatus === 'running' && 'ring-2 ring-blue-400/50',
        execStatus === 'failed' && 'ring-2 ring-red-400/50',
      )}
    >
      {/* Left accent bar */}
      <div className={cn('absolute left-0 top-0 bottom-0 w-1 rounded-l-lg', colors.border, 'bg-current')} 
           style={{ color: 'transparent', borderLeftWidth: '3px' }} />

      {/* Execution status indicator (top-right corner) */}
      {execStatus && execStatus !== 'pending' && (
        <div className="absolute -right-1.5 -top-1.5 z-10">
          {execStatus === 'running' && (
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 shadow-sm">
              <span className="h-2 w-2 animate-spin rounded-full border border-white border-t-transparent" />
            </span>
          )}
          {execStatus === 'success' && (
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-[8px] text-white shadow-sm">
              ✓
            </span>
          )}
          {execStatus === 'failed' && (
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[8px] text-white shadow-sm">
              ✕
            </span>
          )}
          {execStatus === 'skipped' && (
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-zinc-400 text-[8px] text-white shadow-sm">
              –
            </span>
          )}
        </div>
      )}

      {/* Content */}
      <div className="flex items-center gap-2.5 px-3 py-2.5 pl-4">
        <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-xs', colors.icon)}>
          {typeInfo.icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-zinc-900 dark:text-zinc-100">
            {label}
          </p>
          {subtitle && (
            <p className="truncate text-[10px] text-zinc-500 dark:text-zinc-400">
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
              className="!h-3 !w-3 !rounded-full !border-2 !border-zinc-300 !bg-white dark:!border-zinc-600 dark:!bg-zinc-800"
            />
          )}
          {!hideOutput && (
            <Handle
              type="source"
              position={Position.Right}
              className="!h-3 !w-3 !rounded-full !border-2 !border-zinc-300 !bg-white dark:!border-zinc-600 dark:!bg-zinc-800"
            />
          )}
        </>
      )}

      {/* Custom handles for condition nodes etc. */}
      {children}
    </div>
  );
});
