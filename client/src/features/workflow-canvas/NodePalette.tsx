'use client';

import { useCallback, useRef, type DragEvent } from 'react';
import { useReactFlow } from '@xyflow/react';
import { PALETTE_NODE_TYPES, type NodeTypeInfo } from '@/lib/constants';
import { DND_TRANSFER_TYPE } from './hooks/useDragAndDrop';
import { cn } from '@/lib/utils';
import { useWorkflowStore } from '@/stores/workflowStore';
import { useUIStore } from '@/stores/uiStore';

const colorMap: Record<string, string> = {
  emerald: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300',
  sky: 'border-sky-500/20 bg-sky-500/10 text-sky-300',
  amber: 'border-amber-500/20 bg-amber-500/10 text-amber-300',
  violet: 'border-violet-500/20 bg-violet-500/10 text-violet-300',
  teal: 'border-teal-500/20 bg-teal-500/10 text-teal-300',
  rose: 'border-rose-500/20 bg-rose-500/10 text-rose-300',
  zinc: 'border-zinc-500/20 bg-zinc-500/10 text-zinc-300',
};

const PALETTE_CATEGORIES = [
  { label: 'Core', types: ['start', 'end'] },
  { label: 'Logic', types: ['condition', 'delay'] },
  { label: 'Data', types: ['api_call', 'transform'] },
  { label: 'Output', types: ['output'] },
] as const;

interface PaletteItemProps {
  info: NodeTypeInfo;
}

function PaletteItem({ info }: PaletteItemProps) {
  const { screenToFlowPosition } = useReactFlow();
  const addNode = useWorkflowStore((state) => state.addNode);
  const selectNode = useUIStore((state) => state.selectNode);
  const lastActivation = useRef(0);
  const addAtViewportCenter = useCallback(() => {
    const now = Date.now();
    if (now - lastActivation.current < 250) return;
    lastActivation.current = now;
    const position = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    const nodeId = addNode(info.type, position);
    selectNode(nodeId);
  }, [addNode, info.type, screenToFlowPosition, selectNode]);
  function handleDragStart(event: DragEvent<HTMLButtonElement>) {
    // Set the node type as transfer payload — the canvas onDrop reads this
    event.dataTransfer.setData(DND_TRANSFER_TYPE, info.type);
    event.dataTransfer.effectAllowed = 'move';
  }

  return (
    <button
      type="button"
      className="fc-focus group flex cursor-grab items-center gap-2.5 rounded-lg border border-transparent px-2.5 py-2 transition-colors hover:border-[var(--border-subtle)] hover:bg-[var(--surface-hover)] active:cursor-grabbing"
      draggable
      onDragStart={handleDragStart}
      onClick={addAtViewportCenter}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); addAtViewportCenter(); } }}
      title={`${info.description}. Click to add to canvas or drag to position.`}
      aria-label={`Add ${info.label} node`}
    >
      <span
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-md border text-xs',
          colorMap[info.color]
        )}
      >
        {info.icon}
      </span>
      <div className="min-w-0">
        <p className="text-xs font-medium text-[var(--text-primary)]">
          {info.label}
        </p>
        <p className="truncate text-[10px] text-[var(--text-muted)]">
          {info.description}
        </p>
      </div>
    </button>
  );
}

export function NodePalette() {
  return (
    <aside aria-label="Node palette" className="flex h-full w-60 flex-col border-r border-[var(--border-subtle)] bg-[var(--surface-shell)]">
      <div className="border-b border-[var(--border-faint)] px-4 py-3.5">
        <p className="fc-kicker text-violet-400">Builder</p>
        <h2 className="mt-1 text-sm font-semibold text-[var(--text-primary)]">Add a node</h2>
      </div>

      <div className="flex flex-col gap-4 overflow-y-auto p-3">
        {PALETTE_CATEGORIES.map((category) => (
          <section key={category.label} aria-labelledby={`palette-${category.label.toLowerCase()}`}>
            <h3 id={`palette-${category.label.toLowerCase()}`} className="px-2 pb-1.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">{category.label}</h3>
            <div className="space-y-0.5">
              {category.types.map((type) => {
                const info = PALETTE_NODE_TYPES.find((item) => item.type === type);
                return info ? <PaletteItem key={info.type} info={info} /> : null;
              })}
            </div>
          </section>
        ))}
      </div>

      <div className="mt-auto border-t border-[var(--border-faint)] px-4 py-3">
        <p className="text-[10px] leading-4 text-[var(--text-muted)]">
          Click to add to canvas or drag to position.
        </p>
      </div>
    </aside>
  );
}
