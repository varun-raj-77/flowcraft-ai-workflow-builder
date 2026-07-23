'use client';

import React from 'react';
import Link from 'next/link';
import type { WorkflowSummary } from '@/types';
import { formatDate } from '@/lib/utils';

interface WorkflowCardProps {
  workflow: WorkflowSummary;
  onDelete: (id: string) => void;
}

export function WorkflowCard({ workflow, onDelete }: WorkflowCardProps) {
  const promptPreview = workflow.generationMetadata?.originalPrompt;
  const nodeCount = workflow.nodeCount;
  const lastExecutionStatus = workflow.lastExecutionStatus;
  const statusLabel = lastExecutionStatus === null
    ? 'Never run'
    : lastExecutionStatus === undefined
      ? 'Execution status unavailable'
      : `Last run: ${lastExecutionStatus[0].toUpperCase()}${lastExecutionStatus.slice(1)}`;

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white p-5 transition-all duration-200 hover:-translate-y-1 hover:border-zinc-300 hover:shadow-xl hover:shadow-zinc-200/50 focus-within:border-zinc-400 focus-within:shadow-lg dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:shadow-black/20 dark:focus-within:border-zinc-600">
      <Link
        href={`/editor/${workflow._id}`}
        aria-label={`Open ${workflow.name}`}
        className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
      >
      {/* Header */}
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {workflow.name}
          </h3>
          {promptPreview ? (
            <p className="mt-1 line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400">
              Generated from: {promptPreview}
            </p>
          ) : workflow.description && (
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

      <div className="mb-4 flex flex-wrap items-center justify-between gap-1 rounded-lg bg-zinc-50 px-3 py-2 text-[11px] dark:bg-zinc-800/70">
        <span className="font-medium text-zinc-600 dark:text-zinc-300">{nodeCount === undefined ? 'Node count unavailable' : `${nodeCount} ${nodeCount === 1 ? 'node' : 'nodes'}`}</span>
        <span className={lastExecutionStatus === 'failed' ? 'text-red-600 dark:text-red-400' : lastExecutionStatus === 'completed' ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-400'}>{statusLabel}</span>
      </div>
      </Link>

      {/* Footer */}
      <div className="mt-auto flex items-center justify-between gap-3">
        <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
          {workflow.isGeneratedByAI ? 'Generated · ' : ''}Updated {formatDate(workflow.updatedAt)}
        </span>

        <button
          type="button"
          onClick={() => onDelete(workflow._id)}
          className="rounded-md p-1 text-xs text-zinc-400 opacity-100 transition-colors hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100 dark:hover:bg-red-950 dark:hover:text-red-400"
          aria-label={`Delete ${workflow.name}`}
        >
          Delete
        </button>
      </div>
    </article>
  );
}
