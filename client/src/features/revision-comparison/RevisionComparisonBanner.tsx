'use client';

import React from 'react';
import { Button } from '@/components/ui/Button';
import { useRevisionComparisonStore } from '@/stores/revisionComparisonStore';
import { useRevisionHistoryStore } from '@/stores/revisionHistoryStore';
import { useWorkflowStore } from '@/stores/workflowStore';

const LEGEND = [
  ['bg-emerald-500', 'Added'],
  ['bg-amber-500', 'Modified'],
  ['bg-sky-500', 'Moved'],
  ['bg-red-500', 'Removed'],
] as const;

export function RevisionComparisonBanner() {
  const comparison = useRevisionComparisonStore((state) => state.comparison);
  const exitComparison = useRevisionComparisonStore((state) => state.exitComparison);
  const openHistory = useRevisionHistoryStore((state) => state.openHistory);
  const meta = useWorkflowStore((state) => state.meta);
  const isDirty = useWorkflowStore((state) => state.isDirty);

  if (!comparison || !meta?._id) return null;

  const changedNodes = comparison.summary.nodes.added + comparison.summary.nodes.removed + comparison.summary.nodes.modified;
  const changedEdges = comparison.summary.edges.added + comparison.summary.edges.removed + comparison.summary.edges.modified;

  const backToHistory = () => {
    exitComparison();
    void openHistory(meta._id);
  };

  return (
    <div role="status" aria-label="Revision comparison mode" className="flex flex-wrap items-center justify-between gap-3 border-b border-sky-500/30 bg-sky-500/10 px-4 py-3 text-[var(--text-primary)] shadow-[inset_3px_0_0_var(--info)]">
      <div>
        <p className="text-xs font-semibold">
          Comparing v{comparison.from.revision} → v{comparison.to.revision}
        </p>
        <p className="mt-0.5 text-[11px] text-sky-100/70">
          Read-only revision comparison{isDirty ? ' · current means the persisted revision; your unsaved draft is preserved separately' : ''}
        </p>
        <p className="mt-1 text-[10px] font-medium text-sky-200">{changedNodes} changed {changedNodes === 1 ? 'node' : 'nodes'} · {changedEdges} changed {changedEdges === 1 ? 'edge' : 'edges'}</p>
        <div aria-label="Comparison legend" className="mt-1.5 flex flex-wrap gap-3">
          {LEGEND.map(([tone, label]) => (
            <span key={label} className="inline-flex items-center gap-1 text-[10px] text-[var(--text-secondary)]">
              <span className={`h-2 w-2 rounded-full ${tone}`} aria-hidden="true" />{label}
            </span>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={backToHistory}>Back to history</Button>
        <Button variant="secondary" size="sm" onClick={exitComparison}>
          Back to current v{meta.currentRevision}
        </Button>
      </div>
    </div>
  );
}
