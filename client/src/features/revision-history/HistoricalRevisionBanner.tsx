'use client';

import React, { useRef } from 'react';
import { Button } from '@/components/ui/Button';
import { useModalDialog } from '@/lib/useModalDialog';
import { useRevisionHistoryStore } from '@/stores/revisionHistoryStore';
import { useWorkflowStore } from '@/stores/workflowStore';

export function HistoricalRevisionBanner() {
  const preview = useRevisionHistoryStore((state) => state.previewRevision);
  const backToCurrent = useRevisionHistoryStore((state) => state.backToCurrent);
  const openRestoreDialog = useRevisionHistoryStore((state) => state.openRestoreDialog);
  const isRestoreDialogOpen = useRevisionHistoryStore((state) => state.isRestoreDialogOpen);
  const closeRestoreDialog = useRevisionHistoryStore((state) => state.closeRestoreDialog);
  const restorePreview = useRevisionHistoryStore((state) => state.restorePreview);
  const refreshHistory = useRevisionHistoryStore((state) => state.refreshHistory);
  const isRestoring = useRevisionHistoryStore((state) => state.isRestoring);
  const restoreError = useRevisionHistoryStore((state) => state.restoreError);
  const meta = useWorkflowStore((state) => state.meta);
  const isDirty = useWorkflowStore((state) => state.isDirty);
  const setWorkflow = useWorkflowStore((state) => state.setWorkflow);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useModalDialog({
    isOpen: isRestoreDialogOpen,
    onClose: closeRestoreDialog,
    canClose: !isRestoring,
    initialFocusRef: cancelRef,
  });

  if (!preview || !meta?._id || !meta.currentRevision) return null;

  const confirmRestore = async () => {
    try {
      const restored = await restorePreview(meta._id, meta.currentRevision!);
      setWorkflow(restored);
      await refreshHistory(restored._id);
    } catch {
      // The store exposes an actionable error while preserving the preview.
    }
  };

  const newRevision = meta.currentRevision + 1;
  return (
    <>
      <div role="status" className="flex flex-wrap items-center justify-between gap-3 border-b border-violet-500/30 bg-violet-500/10 px-4 py-3 text-[var(--text-primary)] shadow-[inset_3px_0_0_var(--accent)]">
        <div>
          <p className="text-xs font-semibold">Viewing v{preview.revision}</p>
          <div className="mt-0.5 flex flex-wrap gap-x-1.5 text-[11px] text-violet-200/75">
            <p>Historical revision · Read only</p><span>· Current workflow remains unchanged</span>
          </div>
          {isDirty && (
            <p className="mt-1 text-[11px] text-amber-300">
              Save or discard your current changes before restoring a revision.
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={backToCurrent}>
            Back to current v{meta.currentRevision}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={openRestoreDialog}
            disabled={isDirty}
            title={isDirty ? 'Save or discard your current changes before restoring a revision.' : undefined}
          >
            Restore v{preview.revision}
          </Button>
        </div>
      </div>

      {isRestoreDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
          <button
            type="button"
            aria-label="Cancel restore"
            className="absolute inset-0 h-full w-full cursor-default bg-black/60"
            onClick={() => { if (!isRestoring) closeRestoreDialog(); }}
          />
          <div
            ref={dialogRef}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="restore-revision-title"
            aria-describedby="restore-revision-description"
            tabIndex={-1}
            className="relative z-10 w-full max-w-md rounded-xl border border-[var(--border-default)] bg-[var(--surface-overlay)] p-5 text-[var(--text-primary)] shadow-2xl outline-none"
          >
            <h2 id="restore-revision-title" className="text-base font-semibold">Restore v{preview.revision}?</h2>
            <p id="restore-revision-description" className="mt-2 text-sm leading-6 text-zinc-300">
              FlowCraft will create a new revision from v{preview.revision}. Current history will not be deleted.
            </p>
            <dl className="mt-4 grid grid-cols-2 gap-2 rounded-lg border border-[var(--border-faint)] bg-[var(--surface-base)] px-3 py-3 text-xs">
              <dt className="text-zinc-500">Current</dt>
              <dd className="text-right font-medium">v{meta.currentRevision}</dd>
              <dt className="text-zinc-500">New revision</dt>
              <dd className="text-right font-medium">v{newRevision}</dd>
            </dl>
            {restoreError && (
              <p role="alert" className="mt-3 rounded-lg border border-red-900/60 bg-red-950/30 px-3 py-2 text-xs text-red-300">
                {restoreError}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                ref={cancelRef}
                type="button"
                onClick={closeRestoreDialog}
                disabled={isRestoring}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-400 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 disabled:pointer-events-none disabled:opacity-50"
              >
                Cancel
              </button>
              <Button variant="primary" size="sm" onClick={() => { void confirmRestore(); }} isLoading={isRestoring}>
                Restore as new revision
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
