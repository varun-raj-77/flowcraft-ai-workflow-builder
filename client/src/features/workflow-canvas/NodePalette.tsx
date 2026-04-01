'use client';

import { type DragEvent } from 'react';
import { PALETTE_NODE_TYPES, type NodeTypeInfo } from '@/lib/constants';
import { DND_TRANSFER_TYPE } from './hooks/useDragAndDrop';
import { cn } from '@/lib/utils';

const colorMap: Record<string, string> = {
  emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  sky: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400',
  amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  violet: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
  teal: 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400',
  rose: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400',
  zinc: 'bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-400',
};

interface PaletteItemProps {
  info: NodeTypeInfo;
}

function PaletteItem({ info }: PaletteItemProps) {
  function handleDragStart(event: DragEvent<HTMLDivElement>) {
    // Set the node type as transfer payload — the canvas onDrop reads this
    event.dataTransfer.setData(DND_TRANSFER_TYPE, info.type);
    event.dataTransfer.effectAllowed = 'move';
  }

  return (
    <div
      className="flex cursor-grab items-center gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2.5 transition-colors hover:border-zinc-300 active:cursor-grabbing dark:border-zinc-700 dark:bg-zinc-800 dark:hover:border-zinc-600"
      draggable
      onDragStart={handleDragStart}
      title={info.description}
    >
      <span
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-sm',
          colorMap[info.color]
        )}
      >
        {info.icon}
      </span>
      <div className="min-w-0">
        <p className="text-xs font-medium text-zinc-900 dark:text-zinc-100">
          {info.label}
        </p>
        <p className="truncate text-[10px] text-zinc-500 dark:text-zinc-400">
          {info.description}
        </p>
      </div>
    </div>
  );
}

export function NodePalette() {
  return (
    <aside className="flex h-full w-60 flex-col border-r border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/50">
      <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          Nodes
        </h2>
      </div>

      <div className="flex flex-col gap-2 overflow-y-auto p-3">
        {PALETTE_NODE_TYPES.map((info) => (
          <PaletteItem key={info.type} info={info} />
        ))}
      </div>

      <div className="mt-auto border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <p className="text-[10px] text-zinc-400 dark:text-zinc-500">
          Drag a node onto the canvas to add it.
        </p>
      </div>
    </aside>
  );
}
