'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useWorkflowStore } from '@/stores/workflowStore';
import { useUIStore } from '@/stores/uiStore';
import { Button } from '@/components/ui/Button';
import { useSaveWorkflow } from './hooks/useSaveWorkflow';
import { useRunWorkflow } from './hooks/useRunWorkflow';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { GenerationPromptModal } from '@/features/ai-generator/GenerationPromptModal';
import { validateWorkflowPreflight } from './workflowPreflight';

function InlineNameEditor() {
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
        className="max-w-56 rounded-md border border-zinc-300 bg-transparent px-2 py-0.5 text-sm font-medium text-zinc-900 outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-400/30 dark:border-zinc-600 dark:text-zinc-100"
        style={{ width: `${Math.min(Math.max(draft.length, 10), 28) * 8 + 20}px` }}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={startEditing}
      className="max-w-56 truncate rounded-md px-2 py-0.5 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 dark:text-zinc-100 dark:hover:bg-zinc-800"
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
  const [isGenerationPromptOpen, setGenerationPromptOpen] = useState(false);
  const [showPreflight, setShowPreflight] = useState(false);
  const findings = validateWorkflowPreflight(nodes, edges);
  const errors = findings.filter((finding) => finding.severity === 'error');

  const { save, status } = useSaveWorkflow();
  const { run, isRunning } = useRunWorkflow();

  useKeyboardShortcuts({ onSave: () => { void save().catch(() => undefined); }, onUndo: undo, onRedo: redo });

  return (
    <div className="relative flex min-h-12 min-w-0 items-center justify-between gap-3 border-b border-zinc-200 bg-white px-3 dark:border-zinc-800 dark:bg-zinc-950 sm:px-4">
      {/* Left: Editable workflow name + status */}
      <div className="flex min-w-0 shrink items-center gap-2">
        <InlineNameEditor />
        {isDirty && status === 'idle' && (
          <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
            Unsaved
          </span>
        )}
        {status === 'saved' && (
          <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
            Saved
          </span>
        )}
        {status === 'error' && (
          <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
            Save failed
          </span>
        )}
      </div>

      {/* Right: Actions */}
      <div className="flex min-w-0 shrink-0 items-center gap-1 overflow-x-auto py-1 sm:gap-2">
        <button type="button" onClick={undo} disabled={!canUndo} aria-label="Undo" title="Undo (Ctrl+Z)" className="rounded-md px-2 py-1 text-sm text-zinc-600 hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-zinc-800">↶</button>
        <button type="button" onClick={redo} disabled={!canRedo} aria-label="Redo" title="Redo (Ctrl+Shift+Z)" className="rounded-md px-2 py-1 text-sm text-zinc-600 hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-zinc-800">↷</button>
        <Button variant="ghost" size="sm" onClick={openAIModal}>
          ✦ AI Generate
        </Button>
        {meta?.isGeneratedByAI && <Button variant="ghost" size="sm" onClick={() => setGenerationPromptOpen(true)}>Generation Prompt</Button>}
        <Button
          variant="secondary"
          size="sm"
          onClick={() => { void save().catch(() => undefined); }}
          isLoading={status === 'saving'}
          disabled={!isDirty && !!meta?._id}
        >
          Save
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={() => { void run(); }}
          isLoading={isRunning}
          disabled={!meta?._id && !isDirty}
        >
          Run
        </Button>
        <button type="button" aria-expanded={showPreflight} aria-controls="workflow-preflight-panel" onClick={() => setShowPreflight((current) => !current)} className={`rounded-md px-2 py-1 text-[10px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${errors.length ? 'bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-300' : findings.length ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300'}`}>{errors.length ? `${errors.length} issues` : findings.length ? `${findings.length} warnings` : 'Ready'}</button>
      </div>
      {showPreflight && <div id="workflow-preflight-panel" role="region" aria-label="Workflow preflight results" className="absolute right-3 top-full z-30 mt-1 max-h-[min(24rem,calc(100vh-8rem))] w-80 max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-lg border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"><p className="text-xs font-semibold">Workflow Preflight</p>{findings.length === 0 ? <p className="mt-2 text-xs text-emerald-600">Ready to run.</p> : <ul className="mt-2 space-y-2">{findings.map((finding) => <li key={finding.id} className="flex gap-2 text-xs"><span className={finding.severity === 'error' ? 'text-red-600' : 'text-amber-600'}>{finding.severity === 'error' ? 'Error' : 'Warning'}</span><span className="flex-1">{finding.message}</span>{finding.nodeId && <button type="button" onClick={() => selectNode(finding.nodeId!)} className="rounded text-blue-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">Focus</button>}</li>)}</ul>}</div>}
      <GenerationPromptModal isOpen={isGenerationPromptOpen} onClose={() => setGenerationPromptOpen(false)} />
    </div>
  );
}
