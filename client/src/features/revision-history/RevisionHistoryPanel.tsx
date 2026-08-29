'use client';

import React, { useRef } from 'react';
import { Button } from '@/components/ui/Button';
import { useModalDialog } from '@/lib/useModalDialog';
import { useRevisionHistoryStore } from '@/stores/revisionHistoryStore';
import { useUIStore } from '@/stores/uiStore';
import { useWorkflowStore } from '@/stores/workflowStore';
import type { WorkflowRevisionSummary } from '@/types';
import { useRevisionComparisonStore } from '@/stores/revisionComparisonStore';

function sourceLabel(revision: WorkflowRevisionSummary): string {
  if (revision.source === 'ai_generated') return 'AI generated';
  if (revision.source === 'restore') {
    return revision.restoredFromRevision
      ? `Restored from v${revision.restoredFromRevision}`
      : 'Restored';
  }
  return 'Manual';
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function RevisionHistoryPanel() {
  const meta = useWorkflowStore((state) => state.meta);
  const isOpen = useRevisionHistoryStore((state) => state.isPanelOpen);
  const revisions = useRevisionHistoryStore((state) => state.revisions);
  const nextBeforeRevision = useRevisionHistoryStore((state) => state.nextBeforeRevision);
  const isLoading = useRevisionHistoryStore((state) => state.isLoading);
  const isLoadingMore = useRevisionHistoryStore((state) => state.isLoadingMore);
  const historyError = useRevisionHistoryStore((state) => state.historyError);
  const previewError = useRevisionHistoryStore((state) => state.previewError);
  const isPreviewLoading = useRevisionHistoryStore((state) => state.isPreviewLoading);
  const closeHistory = useRevisionHistoryStore((state) => state.closeHistory);
  const refreshHistory = useRevisionHistoryStore((state) => state.refreshHistory);
  const loadMore = useRevisionHistoryStore((state) => state.loadMore);
  const preview = useRevisionHistoryStore((state) => state.preview);
  const backToCurrent = useRevisionHistoryStore((state) => state.backToCurrent);
  const compare = useRevisionComparisonStore((state) => state.compare);
  const exitComparison = useRevisionComparisonStore((state) => state.exitComparison);
  const comparisonError = useRevisionComparisonStore((state) => state.error);
  const isComparisonLoading = useRevisionComparisonStore((state) => state.isLoading);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useModalDialog({
    isOpen,
    onClose: closeHistory,
    initialFocusRef: closeButtonRef,
  });

  if (!isOpen || !meta?._id) return null;

  const selectRevision = async (revision: number) => {
    useUIStore.getState().closeAIModal();
    if (useRevisionComparisonStore.getState().comparison) exitComparison();
    if (revision === meta.currentRevision) {
      backToCurrent();
      closeHistory();
      return;
    }
    await preview(meta._id, revision);
  };

  const compareWithCurrent = async (revision: number) => {
    if (!meta.currentRevision) return;
    useUIStore.getState().closeAIModal();
    await compare(meta._id, revision, meta.currentRevision);
    const loaded = useRevisionComparisonStore.getState().comparison;
    if (loaded?.from.revision === revision && loaded.to.revision === meta.currentRevision) closeHistory();
  };

  return (
    <div className="fixed inset-0 z-40">
      <button
        type="button"
        aria-label="Close revision history"
        className="absolute inset-0 h-full w-full cursor-default bg-black/50"
        onClick={closeHistory}
      />
      <aside
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="revision-history-title"
        aria-describedby="revision-history-description"
        tabIndex={-1}
        className="absolute right-0 top-0 flex h-full w-full max-w-sm flex-col border-l border-[var(--border-default)] bg-[var(--surface-overlay)] text-[var(--text-primary)] shadow-2xl outline-none"
      >
        <div className="flex items-start justify-between border-b border-[var(--border-subtle)] px-5 py-4">
          <div>
            <p className="fc-kicker mb-1 text-violet-400">Workflow record</p>
            <h2 id="revision-history-title" className="text-base font-semibold">Revision history</h2>
            <p id="revision-history-description" className="mt-1 text-xs text-[var(--text-muted)]">
              Historical revisions are read-only.
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={closeHistory}
            aria-label="Close revision history"
            className="fc-focus rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
          >
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {isLoading && (
            <div role="status" className="flex items-center gap-2 rounded-lg border border-zinc-800 px-3 py-4 text-xs text-zinc-400">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-300" />
              Loading revision history…
            </div>
          )}

          {!isLoading && historyError && (
            <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-3 text-xs text-red-300">
              <span>{historyError}</span><Button variant="ghost" size="sm" onClick={() => { void refreshHistory(meta._id); }}>Retry</Button>
            </div>
          )}

          {!isLoading && !historyError && revisions.length === 0 && (
            <p className="rounded-lg border border-zinc-800 px-3 py-4 text-xs text-zinc-400">
              No revisions are available for this workflow.
            </p>
          )}

          {previewError && (
            <p role="alert" className="mb-3 rounded-lg border border-red-900/60 bg-red-950/30 px-3 py-3 text-xs text-red-300">
              {previewError}
            </p>
          )}

          {comparisonError && (
            <p role="alert" className="mb-3 rounded-lg border border-red-900/60 bg-red-950/30 px-3 py-3 text-xs text-red-300">
              {comparisonError}
            </p>
          )}

          <ol className="space-y-2">
            {revisions.map((revision) => {
              const isCurrent = revision.revision === meta.currentRevision;
              return (
                <li key={revision.id} className={`overflow-hidden rounded-lg border ${isCurrent ? 'border-violet-500/40 bg-violet-500/10' : 'border-[var(--border-subtle)] bg-[var(--surface-base)]'}`}>
                  <button
                    type="button"
                    onClick={() => { void selectRevision(revision.revision); }}
                    disabled={isPreviewLoading || isComparisonLoading}
                    aria-label={`${isCurrent ? 'Return to current' : 'View'} revision v${revision.revision}`}
                    className="fc-focus w-full px-3 py-3 text-left transition-colors hover:bg-[var(--surface-hover)] disabled:cursor-wait disabled:opacity-60"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-semibold">v{revision.revision}</span>
                      {isCurrent && (
                        <span className="rounded-md border border-violet-500/25 bg-violet-500/10 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wide text-violet-300">
                          Current
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-xs font-medium text-[var(--text-secondary)]">{sourceLabel(revision)}</p>
                    <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                      {revision.nodeCount} {revision.nodeCount === 1 ? 'node' : 'nodes'} · {revision.edgeCount} {revision.edgeCount === 1 ? 'edge' : 'edges'}
                    </p>
                    <time dateTime={revision.createdAt} className="mt-1 block text-[11px] text-[var(--text-muted)]">
                      {formatTimestamp(revision.createdAt)}
                    </time>
                  </button>
                  {!isCurrent && meta.currentRevision && (
                    <button
                      type="button"
                      onClick={() => { void compareWithCurrent(revision.revision); }}
                      disabled={isPreviewLoading || isComparisonLoading}
                      aria-label={`Compare revision v${revision.revision} with current v${meta.currentRevision}`}
                      className="fc-focus w-full border-t border-[var(--border-faint)] px-3 py-2 text-left text-[10px] font-medium text-sky-300 hover:bg-sky-500/5 disabled:cursor-wait disabled:opacity-60"
                    >
                      Compare with current v{meta.currentRevision}
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
        </div>

        {nextBeforeRevision !== null && (
          <div className="border-t border-[var(--border-subtle)] px-4 py-3">
            <Button
              variant="secondary"
              size="sm"
              className="w-full"
              onClick={() => { void loadMore(); }}
              isLoading={isLoadingMore}
            >
              Load more
            </Button>
          </div>
        )}
      </aside>
    </div>
  );
}
