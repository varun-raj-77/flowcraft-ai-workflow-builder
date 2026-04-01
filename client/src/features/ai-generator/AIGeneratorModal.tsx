'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useUIStore } from '@/stores/uiStore';
import { useWorkflowStore } from '@/stores/workflowStore';
import { Button } from '@/components/ui/Button';
import * as api from '@/lib/api';
import type { Workflow } from '@/types';

const EXAMPLE_PROMPTS = [
  'Fetch users from an API, filter active users, and log the count',
  'Call a weather API, check if temperature is above 30°C, send an alert if yes',
  'Load data from two endpoints, transform and merge the results, then output a summary',
  'Fetch order data, wait 2 seconds, then log the total revenue',
];

export function AIGeneratorModal() {
  const isOpen = useUIStore((s) => s.isAIModalOpen);
  const closeModal = useUIStore((s) => s.closeAIModal);
  const setWorkflow = useWorkflowStore((s) => s.setWorkflow);
  const router = useRouter();

  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() || isGenerating) return;

    setIsGenerating(true);
    setError(null);

    try {
      const result = await api.generateWorkflow(prompt.trim());

      // Build a full Workflow shape for the store
      const workflow: Workflow = {
        _id: '',
        userId: '',
        name: result.name || 'AI Generated Workflow',
        description: result.description,
        nodes: result.nodes,
        edges: result.edges,
        isGeneratedByAI: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Set the workflow in the store FIRST
      setWorkflow(workflow);
      // Mark as dirty so the editor knows it needs saving
      useWorkflowStore.getState().setDirty();
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
      setIsGenerating(false);
    }
  }, [prompt, isGenerating, setWorkflow, closeModal, router]);

  const handleExampleClick = useCallback((example: string) => {
    setPrompt(example);
    setError(null);
  }, []);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={closeModal}
      />

      {/* Modal */}
      <div className="relative z-10 mx-4 w-full max-w-lg rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-700">
          <div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              ✦ Generate with AI
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              Describe your workflow in plain English.
            </p>
          </div>
          <button
            onClick={closeModal}
            className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4">
          {/* Prompt input */}
          <textarea
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                handleGenerate();
              }
            }}
            placeholder="e.g., Fetch data from an API, check if the response is valid, and log the result..."
            rows={4}
            className="w-full resize-none rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-400/30 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500"
            disabled={isGenerating}
            autoFocus
          />

          {/* Character count */}
          <div className="mt-1.5 flex justify-between">
            <p className="text-[10px] text-zinc-400">
              Ctrl+Enter to generate
            </p>
            <p className="text-[10px] text-zinc-400">
              {prompt.length}/2000
            </p>
          </div>

          {/* Error */}
          {error && (
            <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 dark:bg-red-950/30">
              <p className="text-xs text-red-700 dark:text-red-400">{error}</p>
            </div>
          )}

          {/* Example prompts */}
          {!isGenerating && (
            <div className="mt-4">
              <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                Try an example
              </p>
              <div className="flex flex-wrap gap-1.5">
                {EXAMPLE_PROMPTS.map((example) => (
                  <button
                    key={example}
                    onClick={() => handleExampleClick(example)}
                    className="rounded-md bg-zinc-100 px-2.5 py-1 text-[11px] text-zinc-600 transition-colors hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
                  >
                    {example.length > 50 ? example.slice(0, 50) + '…' : example}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Loading state */}
          {isGenerating && (
            <div className="mt-4 flex items-center gap-3 rounded-lg bg-zinc-50 px-4 py-3 dark:bg-zinc-800/50">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600" />
              <div>
                <p className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Building your workflow...
                </p>
                <p className="text-[10px] text-zinc-500 dark:text-zinc-400">
                  This usually takes 5–15 seconds.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-700">
          <Button variant="ghost" size="sm" onClick={closeModal} disabled={isGenerating}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleGenerate}
            isLoading={isGenerating}
            disabled={!prompt.trim() || prompt.length > 2000}
          >
            Generate Workflow
          </Button>
        </div>
      </div>
    </div>
  );
}
