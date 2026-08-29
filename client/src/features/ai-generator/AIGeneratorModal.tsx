'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useUIStore } from '@/stores/uiStore';
import { useWorkflowStore } from '@/stores/workflowStore';
import { Button } from '@/components/ui/Button';
import { GenerationValidationFeedback } from './GenerationValidationFeedback';
import * as api from '@/lib/api';
import type { Workflow, WorkflowAiPromptContext } from '@/types';
import type { CapabilityCoverage } from '@/types';
import { useModalDialog } from '@/lib/useModalDialog';
import { useRevisionHistoryStore } from '@/stores/revisionHistoryStore';
import { useRevisionComparisonStore } from '@/stores/revisionComparisonStore';

const EXAMPLE_PROMPTS = [
  'Fetch users from an API, filter active users, and log the count',
  'Call a weather API, check if temperature is above 30°C, send an alert if yes',
  'Load data from two endpoints, transform and merge the results, then output a summary',
  'Fetch order data, wait 2 seconds, then log the total revenue',
];

type PromptContextState =
  | { status: 'idle' | 'loading' | 'none' }
  | { status: 'available'; context: Extract<WorkflowAiPromptContext, { status: 'available' }> }
  | { status: 'error'; message: string };

interface AIGeneratorModalProps {
  mode?: 'create' | 'current-workflow';
}

export function AIGeneratorModal({ mode = 'create' }: AIGeneratorModalProps) {
  const isOpen = useUIStore((s) => s.isAIModalOpen);
  const closeModal = useUIStore((s) => s.closeAIModal);
  const applyGeneratedWorkflow = useWorkflowStore((s) => s.applyGeneratedWorkflow);
  const setWorkflow = useWorkflowStore((s) => s.setWorkflow);
  const workflowId = useWorkflowStore((s) => s.meta?._id || null);
  const currentRevision = useWorkflowStore((s) => s.meta?.currentRevision);
  const isHistorical = useRevisionHistoryStore((s) => s.previewRevision !== null);
  const isComparing = useRevisionComparisonStore((s) => s.comparison !== null);
  const isReadOnly = isHistorical || isComparing;
  const router = useRouter();

  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [coverage, setCoverage] = useState<CapabilityCoverage | null>(null);
  const [promptContext, setPromptContext] = useState<PromptContextState>({ status: 'idle' });
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const contextRequestToken = useRef(0);
  const generationInFlight = useRef(false);
  const dialogRef = useModalDialog({
    isOpen: isOpen && !isReadOnly,
    onClose: closeModal,
    canClose: !isGenerating,
    initialFocusRef: promptRef,
  });

  const loadPromptContext = useCallback(async () => {
    const requestToken = contextRequestToken.current + 1;
    contextRequestToken.current = requestToken;
    setPrompt('');
    setError(null);
    setCoverage(null);

    if (mode !== 'current-workflow' || !workflowId || !currentRevision) {
      setPromptContext({ status: 'none' });
      return;
    }

    setPromptContext({ status: 'loading' });
    try {
      const context = await api.getWorkflowAiPromptContext(workflowId);
      if (contextRequestToken.current !== requestToken) return;
      if (context.status === 'available') {
        setPrompt(context.prompt);
        setPromptContext({ status: 'available', context });
      } else if (context.status === 'none') {
        setPromptContext({ status: 'none' });
      } else {
        setPromptContext({ status: 'error', message: context.message });
      }
    } catch (contextError) {
      if (contextRequestToken.current !== requestToken) return;
      setPromptContext({
        status: 'error',
        message: api.getApiErrorMessage(contextError, 'AI prompt history could not be loaded.'),
      });
    }
  }, [mode, workflowId, currentRevision]);

  useEffect(() => {
    if (!isOpen || isReadOnly) {
      contextRequestToken.current += 1;
      return;
    }
    void loadPromptContext();
    return () => { contextRequestToken.current += 1; };
  }, [isOpen, isReadOnly, loadPromptContext]);

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() || generationInFlight.current || useRevisionHistoryStore.getState().previewRevision || useRevisionComparisonStore.getState().comparison) return;

    generationInFlight.current = true;
    setIsGenerating(true);
    setError(null);

    try {
      const workflowIdAtStart = mode === 'current-workflow' ? workflowId : null;
      const revisionAtStart = mode === 'current-workflow' ? currentRevision : undefined;
      if (mode === 'current-workflow' && (!workflowIdAtStart || !revisionAtStart)) {
        setError('Save this workflow before regenerating it with AI.');
        return;
      }

      if (workflowIdAtStart && revisionAtStart) {
        const persisted = await api.regenerateWorkflow(workflowIdAtStart, {
          prompt: prompt.trim(),
          expectedRevision: revisionAtStart,
        });
        if (useWorkflowStore.getState().meta?._id !== workflowIdAtStart) return;
        if (useRevisionHistoryStore.getState().previewRevision || useRevisionComparisonStore.getState().comparison) return;
        setWorkflow(persisted);
        void useRevisionHistoryStore.getState().refreshHistory(workflowIdAtStart);
        closeModal();
        return;
      }

      const result = await api.generateWorkflow(prompt.trim());
      if (useRevisionHistoryStore.getState().previewRevision || useRevisionComparisonStore.getState().comparison) return;
      const resultCoverage = result.generationMetadata.capabilityCoverage;
      if (!resultCoverage?.isComplete) {
        setCoverage(resultCoverage ?? null);
        return;
      }

      const workflow: Pick<Workflow, 'name' | 'description' | 'nodes' | 'edges' | 'generationMetadata'> = {
        name: result.name || 'AI Generated Workflow',
        description: result.description,
        nodes: result.nodes,
        edges: result.edges,
        generationMetadata: result.generationMetadata,
      };

      // A complete generation is one atomic workflow-history entry.
      applyGeneratedWorkflow(workflow);
      closeModal();
      setPrompt('');

      // Navigate — the editor will see nodes already in the store and skip clearWorkflow
      router.push('/editor/new');
    } catch (err) {
      if (err instanceof api.ApiError) {
        setError(err.message);
      } else {
        setError('Something went wrong. Please try again.');
      }
    } finally {
      generationInFlight.current = false;
      setIsGenerating(false);
    }
  }, [prompt, mode, workflowId, currentRevision, setWorkflow, applyGeneratedWorkflow, closeModal, router]);

  const handleExampleClick = useCallback((example: string) => {
    setPrompt(example);
    setError(null);
    setCoverage(null);
  }, []);

  if (!isOpen || isReadOnly) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={() => { if (!isGenerating) closeModal(); }}
      />

      {/* Modal */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-generator-title"
        aria-describedby="ai-generator-description"
        tabIndex={-1}
        className="relative z-10 mx-4 flex max-h-[calc(100vh-2rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--surface-overlay)] shadow-2xl shadow-black/60 outline-none"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-5 py-4">
          <div>
            <p className="fc-kicker mb-1 text-violet-400">AI builder</p>
            <h2 id="ai-generator-title" className="text-base font-semibold text-[var(--text-primary)]">
              ✦ Generate with AI
            </h2>
            <p id="ai-generator-description" className="mt-1 text-xs text-[var(--text-muted)]">
              Describe the outcome, inputs, decisions, and output.
            </p>
          </div>
          <button
            type="button"
            onClick={closeModal}
            disabled={isGenerating}
            aria-label="Close AI generator"
            className="fc-focus rounded-md p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 overflow-y-auto px-5 py-4">
          {promptContext.status === 'loading' && (
            <div role="status" className="mb-3 flex items-center gap-2 rounded-lg border border-[var(--border-faint)] bg-[var(--surface-base)] px-3 py-2 text-xs text-[var(--text-muted)]">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-[var(--border-active)] border-t-violet-400" />
              Loading saved AI prompt…
            </div>
          )}
          {promptContext.status === 'error' && (
            <div role="alert" className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2">
              <p className="text-xs text-red-300">{promptContext.message}</p>
              <Button variant="ghost" size="sm" onClick={() => { void loadPromptContext(); }}>Retry</Button>
            </div>
          )}
          {/* Prompt input */}
          <textarea
            ref={promptRef}
            aria-label="Workflow prompt"
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value);
              setError(null);
              setCoverage(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                void handleGenerate();
              }
            }}
            placeholder="e.g., Fetch data from an API, check if the response is valid, and log the result..."
            rows={4}
            className="fc-control min-h-32 w-full resize-none px-3 py-3 text-sm leading-6 placeholder:text-[var(--text-muted)] focus:border-violet-500/60 focus:ring-2 focus:ring-violet-500/20"
            disabled={isGenerating || promptContext.status === 'loading'}
          />

          {/* Character count */}
          <div className="mt-2 flex justify-between">
            <p className="text-[10px] text-[var(--text-muted)]">
              Ctrl+Enter to generate
            </p>
            <p className="font-mono text-[10px] text-[var(--text-muted)]">
              {prompt.length}/2000
            </p>
          </div>

          {promptContext.status === 'available' && (
            <div className="mt-2 flex flex-wrap items-center gap-x-1.5 text-[11px] text-violet-300">
              <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
              <p>Based on the prompt used to generate this workflow.</p>
              <span className="text-[var(--text-muted)]">Preserved from v{promptContext.context.promptRevision}.</span>
            </div>
          )}

          {!isGenerating && promptContext.status === 'none' && !prompt.trim() && (
            <div className="mt-4 rounded-xl border border-dashed border-violet-500/25 bg-violet-500/5 px-4 py-3 text-center">
              <p className="text-xs font-medium text-violet-200">Start with the outcome you want</p>
              <p className="mt-1 text-[11px] text-[var(--text-muted)]">Include the data source, the decision to make, and what should happen next.</p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div role="alert" className="mt-3 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2">
              <p className="text-xs text-red-300">{error}</p>
            </div>
          )}
          {coverage && !coverage.isComplete && <div className="mt-3"><GenerationValidationFeedback coverage={coverage} /></div>}

          {/* Example prompts */}
          {!isGenerating && (
            <div className="mt-4">
              <p className="fc-kicker mb-2 text-[var(--text-muted)]">
                Try an example
              </p>
              <div className="grid gap-1.5">
                {EXAMPLE_PROMPTS.map((example) => (
                  <button
                    type="button"
                    key={example}
                    onClick={() => handleExampleClick(example)}
                    className="fc-focus rounded-md border border-[var(--border-faint)] bg-[var(--surface-base)] px-3 py-2 text-left text-[11px] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-subtle)] hover:bg-[var(--surface-hover)]"
                  >
                    {example.length > 50 ? example.slice(0, 50) + '…' : example}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Loading state */}
          {isGenerating && (
            <div role="status" aria-live="polite" className="mt-4 rounded-xl border border-violet-500/25 bg-violet-500/5 p-4">
              <div className="flex items-center gap-3">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-violet-400/30 border-t-violet-300" />
              <div>
                <p className="text-xs font-medium text-[var(--text-primary)]">Building workflow…</p>
                <p className="mt-0.5 text-[10px] text-[var(--text-muted)]">
                  Generating and validating the workflow. Changes are applied only after validation.
                </p>
              </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-[var(--border-subtle)] bg-[var(--surface-base)] px-5 py-3">
          <Button variant="ghost" size="sm" onClick={closeModal} disabled={isGenerating}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleGenerate}
            isLoading={isGenerating}
            disabled={!prompt.trim() || prompt.length > 2000 || promptContext.status === 'loading'}
          >
            Generate Workflow
          </Button>
        </div>
      </div>
    </div>
  );
}
