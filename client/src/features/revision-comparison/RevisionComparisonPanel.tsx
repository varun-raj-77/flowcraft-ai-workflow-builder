'use client';

import React from 'react';
import { useReactFlow } from '@xyflow/react';
import { cn } from '@/lib/utils';
import { useRevisionComparisonStore } from '@/stores/revisionComparisonStore';
import { useUIStore } from '@/stores/uiStore';
import type { WorkflowFieldChange, WorkflowNode } from '@/types';

function displayValue(value: unknown, present: boolean): { text: string; truncated: boolean } {
  if (!present) return { text: '(not set)', truncated: false };
  let text: string;
  if (typeof value === 'string') text = value;
  else {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  }
  if (text.length <= 180) return { text, truncated: false };
  return { text: `${text.slice(0, 177)}…`, truncated: true };
}

function ChangedValue({ value, present }: { value: unknown; present: boolean }) {
  const display = displayValue(value, present);
  return <code className="block break-words rounded border border-[var(--border-faint)] bg-[var(--code-surface)] px-2 py-1.5 text-[10px] text-[var(--text-secondary)]">
    {display.text}{display.truncated && <span className="ml-1 text-zinc-500">(truncated)</span>}
  </code>;
}

function FieldChange({ change }: { change: WorkflowFieldChange }) {
  const categoryTone = change.category === 'runtime'
    ? 'bg-violet-950 text-violet-300'
    : change.category === 'layout'
      ? 'bg-sky-950 text-sky-300'
      : 'bg-amber-950 text-amber-300';
  return (
    <li className="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-base)] p-2.5">
      <div className="flex items-center justify-between gap-2">
        <code className="break-all text-[10px] font-semibold text-zinc-200">{change.path}</code>
        <span className={cn('rounded px-1.5 py-0.5 text-[9px] font-medium', categoryTone)}>{change.category}</span>
      </div>
      <div className="mt-2 grid gap-1.5">
        <div><span className="text-[9px] uppercase tracking-wide text-red-400">Before</span><ChangedValue value={change.before} present={change.beforePresent} /></div>
        <div><span className="text-[9px] uppercase tracking-wide text-emerald-400">After</span><ChangedValue value={change.after} present={change.afterPresent} /></div>
      </div>
    </li>
  );
}

function ChangeButton({
  changeKey,
  label,
  detail,
  node,
  tone,
}: {
  changeKey: string;
  label: string;
  detail: string;
  node?: WorkflowNode;
  tone: string;
}) {
  const selected = useRevisionComparisonStore((state) => state.selectedChangeKey === changeKey);
  const selectChange = useRevisionComparisonStore((state) => state.selectChange);
  const selectNode = useUIStore((state) => state.selectNode);
  const { setCenter } = useReactFlow();
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => {
        selectChange(changeKey);
        if (node) {
          selectNode(node.id);
          void setCenter(node.position.x + 90, node.position.y + 45, { zoom: 1.1, duration: 300 });
        }
      }}
      className={cn(
        'w-full rounded-md border px-2.5 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500',
        selected ? 'border-sky-500 bg-sky-500/10' : 'border-[var(--border-subtle)] bg-[var(--surface-base)] hover:border-[var(--border-default)] hover:bg-[var(--surface-raised)]',
      )}
    >
      <span className="flex items-center gap-2 text-xs font-medium text-[var(--text-primary)]"><span className={cn('h-2 w-2 rounded-full', tone)} />{label}</span>
      <span className="mt-1 block text-[10px] text-[var(--text-muted)]">{detail}</span>
    </button>
  );
}

export function RevisionComparisonPanel() {
  const comparison = useRevisionComparisonStore((state) => state.comparison);
  if (!comparison) return null;

  const summary = comparison.summary;
  return (
    <aside aria-label="Revision changes" className="w-96 shrink-0 overflow-y-auto border-l border-[var(--border-default)] bg-[var(--surface-overlay)] px-4 py-4 text-[var(--text-primary)]">
      <p className="fc-kicker text-sky-400">Directional diff</p>
      <h2 className="mt-1 text-base font-semibold">Revision changes</h2>
      <p className="mt-1 text-[11px] text-[var(--text-muted)]">v{comparison.from.revision} → v{comparison.to.revision}</p>
      <dl className="mt-3 grid grid-cols-2 gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-base)] p-3 text-[10px]">
        <div><dt className="text-[var(--text-muted)]">Nodes</dt><dd className="mt-1 font-mono text-xs font-medium">+{summary.nodes.added} −{summary.nodes.removed} ~{summary.nodes.modified}</dd></div>
        <div><dt className="text-[var(--text-muted)]">Edges</dt><dd className="mt-1 font-mono text-xs font-medium">+{summary.edges.added} −{summary.edges.removed} ~{summary.edges.modified}</dd></div>
      </dl>

      {!comparison.hasChanges && (
        <p className="mt-4 rounded-lg border border-zinc-800 px-3 py-4 text-xs text-zinc-400">No graph changes between these revisions.</p>
      )}

      <div className="mt-4 space-y-4">
        {comparison.nodes.added.length > 0 && <section><h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-emerald-400">Added nodes</h3><div className="space-y-2">{comparison.nodes.added.map(({ nodeId, node }) => <ChangeButton key={nodeId} changeKey={`node-added-${nodeId}`} label={node.label} detail={node.type.replace('_', ' ')} node={node} tone="bg-emerald-500" />)}</div></section>}
        {comparison.nodes.removed.length > 0 && <section><h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-red-400">Removed nodes</h3><div className="space-y-2">{comparison.nodes.removed.map(({ nodeId, node }) => <ChangeButton key={nodeId} changeKey={`node-removed-${nodeId}`} label={node.label} detail={`${node.type.replace('_', ' ')} · shown as a ghost at its old position`} node={node} tone="bg-red-500" />)}</div></section>}
        {comparison.nodes.modified.map(({ nodeId, after, changes, changesTruncated }) => (
          <section key={nodeId}>
            <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-amber-400">Modified node</h3>
            <ChangeButton changeKey={`node-modified-${nodeId}`} label={after.label} detail={`${changes.length} field ${changes.length === 1 ? 'change' : 'changes'}`} node={after} tone={changes.every((change) => change.category === 'layout') ? 'bg-sky-500' : 'bg-amber-500'} />
            <ol className="mt-2 space-y-2">{changes.map((change) => <FieldChange key={`${nodeId}-${change.path}`} change={change} />)}</ol>
            {changesTruncated && <p className="mt-2 text-[10px] text-amber-300">Additional field changes were omitted from this bounded response.</p>}
          </section>
        ))}
        {comparison.edges.added.length > 0 && <section><h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-emerald-400">Added edges</h3><div className="space-y-2">{comparison.edges.added.map(({ edgeKey, edge }) => <ChangeButton key={edgeKey} changeKey={`edge-added-${edgeKey}`} label={`${edge.source} → ${edge.target}`} detail="Executable connection added" node={comparison.graph.nodes.find((node) => node.id === edge.source)} tone="bg-emerald-500" />)}</div></section>}
        {comparison.edges.removed.length > 0 && <section><h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-red-400">Removed edges</h3><div className="space-y-2">{comparison.edges.removed.map(({ edgeKey, edge }) => <ChangeButton key={edgeKey} changeKey={`edge-removed-${edgeKey}`} label={`${edge.source} → ${edge.target}`} detail="Shown as a dashed ghost connection" node={comparison.nodes.removed.find(({ nodeId }) => nodeId === edge.source)?.node ?? comparison.graph.nodes.find((node) => node.id === edge.source)} tone="bg-red-500" />)}</div></section>}
        {comparison.edges.modified.map(({ edgeKey, after, changes }) => <section key={edgeKey}><h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-amber-400">Modified edge</h3><ChangeButton changeKey={`edge-modified-${edgeKey}`} label={`${after.source} → ${after.target}`} detail={`${changes.length} presentation ${changes.length === 1 ? 'change' : 'changes'}`} node={comparison.graph.nodes.find((node) => node.id === after.source)} tone="bg-amber-500" /><ol className="mt-2 space-y-2">{changes.map((change) => <FieldChange key={`${edgeKey}-${change.path}`} change={change} />)}</ol></section>)}
      </div>
    </aside>
  );
}
