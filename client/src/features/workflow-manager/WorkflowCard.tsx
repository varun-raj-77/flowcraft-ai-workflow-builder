'use client';

import Link from 'next/link';
import type { Workflow } from '@/types';
import { formatDate } from '@/lib/utils';
import { NODE_TYPE_REGISTRY } from '@/lib/constants';

interface WorkflowCardProps {
  workflow: Workflow;
  onDelete: (id: string) => void;
}

export function WorkflowCard({ workflow, onDelete }: WorkflowCardProps) {
  // Count nodes by type for the summary chips
  // Note: nodes may be undefined when loaded from the list endpoint
  // (which excludes nodes/edges for performance)
  const typeCounts = (workflow.nodes || []).reduce<Record<string, number>>((acc, node) => {
    acc[node.type] = (acc[node.type] || 0) + 1;
    return acc;
  }, {});

  return (
    <Link
      href={`/editor/${workflow._id}`}
      className="group relative flex flex-col rounded-xl border border-zinc-200 bg-white p-5 transition-all hover:border-zinc-300 hover:shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700"
    >
      {/* Header */}
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {workflow.name}
          </h3>
          {workflow.description && (
            <p className="mt-1 line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400">
              {workflow.description}
            </p>
          )}
        </div>

        {workflow.isGeneratedByAI && (
          <span className="shrink-0 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-700 dark:bg-violet-900/30 dark:text-violet-400">
            AI
          </span>
        )}
      </div>

      {/* Node type summary */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        {Object.entries(typeCounts).map(([type, count]) => {
          const info = NODE_TYPE_REGISTRY[type as keyof typeof NODE_TYPE_REGISTRY];
          return (
            <span
              key={type}
              className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-0.5 text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
            >
              <span>{info?.icon}</span>
              {count}
            </span>
          );
        })}
      </div>

      {/* Footer */}
      <div className="mt-auto flex items-center justify-between">
        <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
          Updated {formatDate(workflow.updatedAt)}
        </span>

        <button
          onClick={(e) => {
            e.preventDefault(); // Prevent navigation on delete click
            e.stopPropagation();
            onDelete(workflow._id);
          }}
          className="rounded-md p-1 text-xs text-zinc-400 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 dark:hover:bg-red-950 dark:hover:text-red-400"
          aria-label={`Delete ${workflow.name}`}
        >
          Delete
        </button>
      </div>
    </Link>
  );
}
