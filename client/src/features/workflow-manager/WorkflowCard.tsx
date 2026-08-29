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
    <article className="group relative flex min-h-48 flex-col overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-base)] p-5 transition-colors duration-150 hover:border-[var(--border-default)] hover:bg-[var(--surface-raised)] focus-within:border-violet-500/60">
      <Link
        href={`/editor/${workflow._id}`}
        aria-label={`Open ${workflow.name}`}
        className="fc-focus rounded-lg"
      >
      {/* Header */}
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
          <h3 className="truncate text-sm font-semibold text-[var(--text-primary)]">
            {workflow.name}
          </h3>
          {workflow.currentRevision && <span className="font-mono text-[10px] text-[var(--text-muted)]">v{workflow.currentRevision}</span>}
          </div>
          {promptPreview ? (
            <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-[var(--text-muted)]">
              {promptPreview}
            </p>
          ) : workflow.description && (
            <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-[var(--text-muted)]">
              {workflow.description}
            </p>
          )}
        </div>

        {workflow.isGeneratedByAI && (
          <span className="shrink-0 rounded-md border border-violet-500/25 bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-300">
            AI generated
          </span>
        )}
      </div>

      <div className="mb-4 mt-4 flex flex-wrap items-center justify-between gap-2 border-y border-[var(--border-faint)] py-2.5 text-[11px]">
        <span className="font-medium text-[var(--text-secondary)]">{nodeCount === undefined ? 'Node count unavailable' : `${nodeCount} ${nodeCount === 1 ? 'node' : 'nodes'}`}</span>
        <span className={lastExecutionStatus === 'failed' ? 'text-red-300' : lastExecutionStatus === 'completed' ? 'text-emerald-300' : 'text-[var(--text-muted)]'}>{statusLabel}</span>
      </div>
      </Link>

      {/* Footer */}
      <div className="mt-auto flex items-center justify-between gap-3">
        <span className="text-[11px] text-[var(--text-muted)]">
          Updated {formatDate(workflow.updatedAt)}
        </span>

        <span className="ml-auto text-[11px] font-medium text-violet-300 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">Open →</span>

        <button
          type="button"
          onClick={() => onDelete(workflow._id)}
          className="fc-focus rounded-md px-1.5 py-1 text-[11px] text-[var(--text-muted)] opacity-100 transition-colors hover:bg-red-500/10 hover:text-red-300 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
          aria-label={`Delete ${workflow.name}`}
        >
          Delete
        </button>
      </div>
    </article>
  );
}
