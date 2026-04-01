'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useWorkflowStore } from '@/stores/workflowStore';
import { useUIStore } from '@/stores/uiStore';
import { Button } from '@/components/ui/Button';
import { useSaveWorkflow } from './hooks/useSaveWorkflow';
import { useRunWorkflow } from './hooks/useRunWorkflow';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';

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
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitName}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commitName();
          if (e.key === 'Escape') setIsEditing(false);
        }}
        className="rounded-md border border-zinc-300 bg-transparent px-2 py-0.5 text-sm font-medium text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-600 dark:text-zinc-100"
        style={{ width: `${Math.max(draft.length, 10) * 8 + 20}px` }}
      />
    );
  }

  return (
    <button
      onClick={startEditing}
      className="rounded-md px-2 py-0.5 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-800"
      title="Click to rename"
    >
      {meta?.name ?? 'Untitled Workflow'}
    </button>
  );
}

export function CanvasToolbar() {
  const isDirty = useWorkflowStore((s) => s.isDirty);
  const meta = useWorkflowStore((s) => s.meta);
  const openAIModal = useUIStore((s) => s.openAIModal);

  const { save, status } = useSaveWorkflow();
  const { run, isRunning } = useRunWorkflow();

  useKeyboardShortcuts({ onSave: save });

  return (
    <div className="flex h-12 items-center justify-between border-b border-zinc-200 bg-white px-4 dark:border-zinc-800 dark:bg-zinc-950">
      {/* Left: Editable workflow name + status */}
      <div className="flex items-center gap-2">
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
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={openAIModal}>
          ✦ AI Generate
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={save}
          isLoading={status === 'saving'}
          disabled={!isDirty && !!meta?._id}
        >
          Save
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={run}
          isLoading={isRunning}
          disabled={!meta?._id && !isDirty}
        >
          Run
        </Button>
      </div>
    </div>
  );
}
