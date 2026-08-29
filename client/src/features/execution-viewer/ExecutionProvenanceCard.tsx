'use client';

import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import * as api from '@/lib/api';
import { useRevisionComparisonStore } from '@/stores/revisionComparisonStore';
import { useRevisionHistoryStore } from '@/stores/revisionHistoryStore';
import { useWorkflowStore } from '@/stores/workflowStore';
import type { ExecutionRevisionProvenance, ExecutionRun } from '@/types';

function abbreviatedHash(hash: string): string {
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

export function ExecutionProvenanceCard({ run }: { run: ExecutionRun }) {
  const [provenance, setProvenance] = useState<ExecutionRevisionProvenance | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const preview = useRevisionHistoryStore((state) => state.preview);
  const compare = useRevisionComparisonStore((state) => state.compare);
  const currentWorkflowRevision = useWorkflowStore((state) => state.meta?.currentRevision);

  const hasNoPinnedFields = !run.workflowRevisionId && !run.workflowRevision && !run.definitionHash;
  useEffect(() => {
    let active = true;
    setActionError(null);
    if (hasNoPinnedFields) {
      setProvenance({
        status: 'legacy',
        runId: run._id,
        workflowId: run.workflowId,
        isCurrent: false,
        canView: false,
        canCompare: false,
        message: 'This legacy run did not capture an exact workflow revision.',
      });
      setIsLoading(false);
      return () => { active = false; };
    }

    setProvenance(null);
    setIsLoading(true);
    void api.getExecutionRevisionProvenance(run._id)
      .then((value) => { if (active) setProvenance(value); })
      .catch((error) => {
        if (!active) return;
        setProvenance({
          status: 'unavailable',
          runId: run._id,
          workflowId: run.workflowId,
          workflowRevision: run.workflowRevision,
          workflowRevisionId: run.workflowRevisionId,
          definitionHash: run.definitionHash,
          isCurrent: false,
          canView: false,
          canCompare: false,
          message: api.getApiErrorMessage(error, 'Execution provenance could not be verified.'),
        });
      })
      .finally(() => { if (active) setIsLoading(false); });
    return () => { active = false; };
  }, [hasNoPinnedFields, run._id, run.workflowId, run.workflowRevision, run.workflowRevisionId, run.definitionHash, currentWorkflowRevision]);

  const viewExactRevision = async () => {
    if (!provenance?.canView || !provenance.workflowRevision || !provenance.definitionHash) return;
    setActionError(null);
    if (useRevisionComparisonStore.getState().comparison) {
      useRevisionComparisonStore.getState().exitComparison();
    }
    await preview(provenance.workflowId, provenance.workflowRevision);
    const loaded = useRevisionHistoryStore.getState().previewRevision;
    if (!loaded || loaded.revision !== provenance.workflowRevision) {
      setActionError(useRevisionHistoryStore.getState().previewError ?? 'The exact revision could not be loaded.');
      return;
    }
    if (loaded.definitionHash !== provenance.definitionHash) {
      useRevisionHistoryStore.getState().backToCurrent();
      setActionError('The loaded revision hash does not match this execution. No fallback was shown.');
    }
  };

  const compareWithCurrent = async () => {
    if (!provenance?.canCompare || !provenance.workflowRevision || !provenance.currentRevision) return;
    setActionError(null);
    await compare(provenance.workflowId, provenance.workflowRevision, provenance.currentRevision);
    if (!useRevisionComparisonStore.getState().comparison) {
      setActionError(useRevisionComparisonStore.getState().error ?? 'The revisions could not be compared.');
    }
  };

  return (
    <section aria-label="Execution workflow revision" className="border-b border-[var(--border-subtle)] bg-violet-500/5 px-4 py-3 text-[10px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="fc-kicker text-violet-400">Workflow revision used</p>
          {isLoading && <p role="status" className="mt-1 text-zinc-400">Verifying pinned revision…</p>}
          {!isLoading && provenance?.status === 'pinned' && (
            <p className="mt-1 text-[var(--text-secondary)]">
              Executed v{provenance.workflowRevision}
              {provenance.isCurrent ? ' · same as current revision' : ` · current v${provenance.currentRevision ?? 'unknown'}`}
              {provenance.definitionHash && <code className="ml-1.5 rounded border border-[var(--border-faint)] bg-[var(--code-surface)] px-1 py-0.5 text-[9px]" title={provenance.definitionHash}>{abbreviatedHash(provenance.definitionHash)}</code>}
            </p>
          )}
          {!isLoading && provenance && provenance.status !== 'pinned' && (
            <p className={`mt-1 ${provenance.status === 'integrity_error' ? 'text-red-600 dark:text-red-400' : 'text-zinc-500'}`}>
              {provenance.status === 'legacy' ? 'Legacy run · ' : ''}{provenance.message}
            </p>
          )}
        </div>
        {!isLoading && provenance?.status === 'pinned' && !provenance.isCurrent && (
          <div className="flex flex-wrap gap-1.5">
            {provenance.canView && <Button variant="ghost" size="sm" onClick={() => { void viewExactRevision(); }}>View exact revision v{provenance.workflowRevision}</Button>}
            {provenance.canCompare && <Button variant="secondary" size="sm" onClick={() => { void compareWithCurrent(); }}>Compare executed → current</Button>}
          </div>
        )}
      </div>
      {actionError && <p role="alert" className="mt-2 text-red-600 dark:text-red-400">{actionError}</p>}
    </section>
  );
}
