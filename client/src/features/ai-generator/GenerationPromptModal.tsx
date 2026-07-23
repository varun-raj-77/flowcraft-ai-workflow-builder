'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import * as api from '@/lib/api';
import { useWorkflowStore } from '@/stores/workflowStore';
import type { GenerationMetadata } from '@/types';
import { GenerationValidationFeedback } from './GenerationValidationFeedback';
import { useModalDialog } from '@/lib/useModalDialog';

interface Props { isOpen: boolean; onClose: () => void; }

export function GenerationPromptModal({ isOpen, onClose }: Props) {
  const meta = useWorkflowStore((state) => state.meta);
  const isDirty = useWorkflowStore((state) => state.isDirty);
  const updateMeta = useWorkflowStore((state) => state.updateMeta);
  const applyGeneratedWorkflow = useWorkflowStore((state) => state.applyGeneratedWorkflow);
  const [prompt, setPrompt] = useState('');
  const [candidate, setCandidate] = useState<Awaited<ReturnType<typeof api.generateWorkflow>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const dialogRef = useModalDialog({
    isOpen: isOpen && Boolean(meta?.isGeneratedByAI),
    onClose,
    canClose: !isGenerating,
    initialFocusRef: promptRef,
  });

  useEffect(() => {
    if (isOpen) { setPrompt(meta?.generationMetadata?.originalPrompt ?? ''); setCandidate(null); setError(null); }
  }, [isOpen, meta?.generationMetadata?.originalPrompt]);
  if (!isOpen || !meta?.isGeneratedByAI) return null;

  const savePrompt = () => {
    const originalPrompt = prompt.trim();
    if (!originalPrompt) return;
    const existing = meta.generationMetadata;
    const generationMetadata: GenerationMetadata = { originalPrompt, generatedAt: existing?.generatedAt ?? new Date().toISOString(), provider: existing?.provider, model: existing?.model, capabilityCoverage: existing?.capabilityCoverage };
    updateMeta({ generationMetadata });
  };
  const editPrompt = (value: string) => {
    setPrompt(value);
  };
  const regenerate = async () => {
    const originalPrompt = prompt.trim();
    if (!originalPrompt || isGenerating) return;
    setIsGenerating(true); setError(null); setCandidate(null);
    try {
      const generated = await api.generateWorkflow(originalPrompt);
      setCandidate(generated);
    } catch (reason) { setError(api.getApiErrorMessage(reason, 'Generation failed. The current graph has not changed.')); }
    finally { setIsGenerating(false); }
  };
  const confirmReplacement = () => { if (candidate?.generationMetadata.capabilityCoverage?.isComplete) { applyGeneratedWorkflow(candidate); setCandidate(null); } };
  const coverage = candidate?.generationMetadata.capabilityCoverage;
  return <div className="fixed inset-0 z-50 flex items-center justify-center">
    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => { if (!isGenerating) onClose(); }} />
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="generation-prompt-title" aria-describedby="generation-prompt-description" tabIndex={-1} className="relative z-10 mx-4 flex max-h-[calc(100vh-2rem)] w-full max-w-2xl flex-col rounded-xl border border-zinc-200 bg-white shadow-2xl outline-none dark:border-zinc-700 dark:bg-zinc-900">
      <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-700"><div><h2 id="generation-prompt-title" className="text-sm font-semibold">Generation Prompt</h2><p id="generation-prompt-description" className="mt-0.5 text-xs text-zinc-500">{isDirty ? 'Unsaved workflow changes' : 'Saved workflow'}</p></div><button type="button" onClick={onClose} disabled={isGenerating} className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-zinc-800" aria-label="Close generation prompt">×</button></div>
      <div className="min-h-0 space-y-3 overflow-y-auto px-5 py-4">
        {!meta.generationMetadata?.originalPrompt && <p className="rounded-md bg-zinc-100 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">Original prompt unavailable for this older AI-generated workflow. Add one explicitly to enable regeneration.</p>}
        <textarea ref={promptRef} value={prompt} onChange={(event) => editPrompt(event.target.value)} rows={7} maxLength={2000} disabled={isGenerating} className="w-full resize-y rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-400/30 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-800" placeholder="Describe the workflow to generate" />
        <div className="flex justify-between text-[11px] text-zinc-500"><span>Prompt edits are saved with the workflow.</span><span>{prompt.length}/2000</span></div>
        {error && <p role="alert" className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">{error}</p>}
        {coverage && !coverage.isComplete && <GenerationValidationFeedback coverage={coverage} />}
        {coverage?.isComplete && <div className="rounded-md border border-zinc-200 p-3 text-xs dark:border-zinc-700"><p className="font-medium">Coverage: {Math.round(coverage.coverage * 100)}%</p><p className="mt-1 text-emerald-600">Revision is ready. Confirm before replacing the graph.</p></div>}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-700"><Button variant="ghost" size="sm" onClick={onClose} disabled={isGenerating}>Close</Button><Button variant="secondary" size="sm" onClick={savePrompt} disabled={!prompt.trim() || isGenerating}>Save Prompt</Button><Button variant="primary" size="sm" onClick={candidate?.generationMetadata.capabilityCoverage?.isComplete ? confirmReplacement : regenerate} isLoading={isGenerating} disabled={!prompt.trim()}>{candidate?.generationMetadata.capabilityCoverage?.isComplete ? 'Confirm Replace Graph' : 'Regenerate'}</Button></div>
    </div>
  </div>;
}
