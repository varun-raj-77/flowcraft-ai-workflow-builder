'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useWorkflowStore } from '@/stores/workflowStore';
import { useUIStore } from '@/stores/uiStore';
import { Button } from '@/components/ui/Button';
import { useSaveWorkflow } from './hooks/useSaveWorkflow';
import { useRunWorkflow } from './hooks/useRunWorkflow';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { validateWorkflowPreflight } from './workflowPreflight';
import { useRevisionHistoryStore } from '@/stores/revisionHistoryStore';
import { useRevisionComparisonStore } from '@/stores/revisionComparisonStore';

function InlineNameEditor({ readOnly = false }: { readOnly?: boolean }) {
  const meta = useWorkflowStore((s) => s.meta);
  const updateMeta = useWorkflowStore((s) => s.updateMeta);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const startEditing = useCallback(() => {
    setDraft(meta?.name ?? 'Untitled Workflow');
    setIsEditing(true);
  }, [meta?.name]);

  const commitName = useCallback(() => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== meta?.name) {
      updateMeta({ name: trimmed });
    }
    setIsEditing(false);
  }, [draft, meta?.name, updateMeta]);

  if (readOnly) {
    return (
      <span className="max-w-56 truncate rounded-md text-sm font-semibold text-[var(--text-primary)]">
        {meta?.name ?? 'Untitled Workflow'}
      </span>
    );
  }

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        maxLength={80}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitName}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commitName();
          if (e.key === 'Escape') setIsEditing(false);
        }}
        className="fc-control max-w-56 px-2 py-1 text-sm font-semibold"
        style={{ width: `${Math.min(Math.max(draft.length, 10), 28) * 8 + 20}px` }}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={startEditing}
      className="fc-focus max-w-56 truncate rounded-md px-1 py-1 text-sm font-semibold text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-hover)]"
      title="Click to rename"
    >
      {meta?.name ?? 'Untitled Workflow'}
    </button>
  );
}

export function CanvasToolbar() {
  const isDirty = useWorkflowStore((s) => s.isDirty);
  const meta = useWorkflowStore((s) => s.meta);
  const nodes = useWorkflowStore((s) => s.nodes);
  const edges = useWorkflowStore((s) => s.edges);
  const undo = useWorkflowStore((s) => s.undo);
  const redo = useWorkflowStore((s) => s.redo);
  const canUndo = useWorkflowStore((s) => s.undoStack.length > 0);
  const canRedo = useWorkflowStore((s) => s.redoStack.length > 0);
  const selectNode = useUIStore((s) => s.selectNode);
  const openAIModal = useUIStore((s) => s.openAIModal);
  const [showPreflight, setShowPreflight] = useState(false);
  const previewRevision = useRevisionHistoryStore((state) => state.previewRevision);
  const openHistory = useRevisionHistoryStore((state) => state.openHistory);
  const isHistorical = previewRevision !== null;
  const comparison = useRevisionComparisonStore((state) => state.comparison);
  const isReadOnly = isHistorical || comparison !== null;
  const findings = validateWorkflowPreflight(nodes, edges);
  const errors = findings.filter((finding) => finding.severity === 'error');

  const { save, status } = useSaveWorkflow();
  const { run, isRunning } = useRunWorkflow();

  useEffect(() => {
    if (isReadOnly) {
      setShowPreflight(false);
    }
  }, [isReadOnly]);

  useKeyboardShortcuts({
    enabled: !isReadOnly,
    onSave: () => { void save().catch(() => undefined); },
    onUndo: undo,
    onRedo: redo,
  });

  const showHistory = () => {
    if (!meta?._id) return;
    useUIStore.getState().closeAIModal();
    void openHistory(meta._id);
  };

  return (
    <header className="relative flex min-h-14 min-w-0 items-center justify-between gap-3 border-b border-[var(--border-subtle)] bg-[var(--surface-shell)] px-3 sm:px-4">
      {/* Left: Editable workflow name + status */}
      <div className="flex min-w-0 shrink items-center gap-2.5">
        <InlineNameEditor readOnly={isReadOnly} />
        {(comparison?.to.revision ?? previewRevision?.revision ?? meta?.currentRevision) && (
          <span className="font-mono text-[10px] font-medium text-[var(--text-muted)]">
            v{comparison?.to.revision ?? previewRevision?.revision ?? meta?.currentRevision}
          </span>
        )}
        {isDirty && status === 'idle' && (
          <span className="flex items-center gap-1.5 text-[10px] font-medium text-amber-300"><span className="h-1.5 w-1.5 rounded-full bg-amber-400" />Unsaved
          </span>
        )}
        {status === 'saved' && (
          <span className="flex items-center gap-1.5 text-[10px] font-medium text-emerald-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />Saved
          </span>
        )}
        {status === 'error' && (
          <span className="flex items-center gap-1.5 text-[10px] font-medium text-red-300"><span className="h-1.5 w-1.5 rounded-full bg-red-400" />Save failed
          </span>
        )}
      </div>

      {/* Right: Actions */}
      <div className="flex min-w-0 shrink-0 items-center gap-1 overflow-x-auto py-1.5">
        <div className="mr-1 flex items-center rounded-lg border border-[var(--border-faint)] bg-[var(--surface-base)] p-0.5">
        <button type="button" onClick={undo} disabled={isReadOnly || !canUndo} aria-label="Undo" title="Undo (Ctrl+Z)" className="fc-focus rounded-md px-2 py-1 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] disabled:opacity-30">↶</button>
        <button type="button" onClick={redo} disabled={isReadOnly || !canRedo} aria-label="Redo" title="Redo (Ctrl+Shift+Z)" className="fc-focus rounded-md px-2 py-1 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] disabled:opacity-30">↷</button>
        </div>
        <Button variant="ghost" size="sm" onClick={showHistory} disabled={!meta?._id}>
          ◷ History
        </Button>
        <Button variant="secondary" size="sm" onClick={openAIModal} disabled={isReadOnly}>
          ✦ AI Generate
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => { void save().catch(() => undefined); }}
          isLoading={status === 'saving'}
          disabled={isReadOnly || (!isDirty && !!meta?._id)}
        >
          Save
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={() => { void run(); }}
          isLoading={isRunning}
          disabled={isReadOnly || (!meta?._id && !isDirty)}
        >
          Run
        </Button>
        <button type="button" disabled={isReadOnly} aria-expanded={showPreflight} aria-controls="workflow-preflight-panel" onClick={() => setShowPreflight((current) => !current)} className={`fc-focus ml-1 flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[10px] font-medium disabled:opacity-40 ${errors.length ? 'text-red-300' : findings.length ? 'text-amber-300' : 'text-emerald-300'}`}><span className={`h-1.5 w-1.5 rounded-full ${errors.length ? 'bg-red-400' : findings.length ? 'bg-amber-400' : 'bg-emerald-400'}`} />{errors.length ? `${errors.length} issues` : findings.length ? `${findings.length} warnings` : 'Ready'}</button>
      </div>
      {showPreflight && <div id="workflow-preflight-panel" role="region" aria-label="Workflow preflight results" className="fc-panel-raised absolute right-3 top-full z-30 mt-1 max-h-[min(24rem,calc(100vh-8rem))] w-80 max-w-[calc(100vw-1.5rem)] overflow-y-auto p-3 shadow-2xl"><p className="text-xs font-semibold text-[var(--text-primary)]">Workflow preflight</p>{findings.length === 0 ? <p className="mt-2 text-xs text-emerald-300">Ready to run.</p> : <ul className="mt-2 space-y-2">{findings.map((finding) => <li key={finding.id} className="flex gap-2 text-xs text-[var(--text-secondary)]"><span className={finding.severity === 'error' ? 'text-red-300' : 'text-amber-300'}>{finding.severity === 'error' ? 'Error' : 'Warning'}</span><span className="flex-1">{finding.message}</span>{finding.nodeId && <button type="button" onClick={() => selectNode(finding.nodeId!)} className="fc-focus rounded text-violet-300 hover:underline">Focus</button>}</li>)}</ul>}</div>}
    </header>
  );
}
