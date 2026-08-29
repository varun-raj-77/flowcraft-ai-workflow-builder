'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { PageLayout } from '@/components/layout/PageLayout';
import { Button } from '@/components/ui/Button';
import { WorkflowList } from '@/features/workflow-manager/WorkflowList';
import { AIGeneratorModal } from '@/features/ai-generator/AIGeneratorModal';
import { useUIStore } from '@/stores/uiStore';
import { useWorkflowStore } from '@/stores/workflowStore';
import { useExecutionStore } from '@/stores/executionStore';
import * as api from '@/lib/api';
import type { WorkflowSummary } from '@/types';

export default function DashboardPage() {
  const router = useRouter();
  const openAIModal = useUIStore((s) => s.openAIModal);
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch workflows on mount
  const fetchWorkflows = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.listWorkflows();
      setWorkflows(data);
    } catch (err) {
      setWorkflows([]);
      setError(api.getApiErrorMessage(err, 'Unable to load workflows. Check your connection and try again.'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchWorkflows();
  }, [fetchWorkflows]);

  // Create a new empty workflow
  async function handleCreate() {
    setError(null);
    try {
      const workflow = await api.createWorkflow({ name: 'Untitled Workflow' });
      router.push(`/editor/${workflow._id}`);
    } catch (err) {
      setError(api.getApiErrorMessage(err, 'Unable to create a workflow. Please try again.'));
    }
  }

  // Delete a workflow
  async function handleDelete(id: string) {
    const workflow = workflows.find((item) => item._id === id);
    const shouldDelete = window.confirm(`Delete "${workflow?.name ?? 'this workflow'}"? This action cannot be undone.`);
    if (!shouldDelete) return;

    // Optimistic update — remove from UI immediately
    setWorkflows((prev) => prev.filter((w) => w._id !== id));
    try {
      await api.deleteWorkflow(id);
      if (useWorkflowStore.getState().meta?._id === id) useWorkflowStore.getState().clearWorkflow();
      if (useExecutionStore.getState().currentRun?.workflowId === id || useExecutionStore.getState().historyWorkflowId === id) {
        useExecutionStore.getState().clearExecution();
        useExecutionStore.getState().clearHistory();
      }
    } catch (err) {
      // Revert on failure
      void fetchWorkflows();
      setError(api.getApiErrorMessage(err, 'Unable to delete the workflow. Please try again.'));
    }
  }

  return (
    <PageLayout>
      {/* Page header */}
      <div className="mb-8 flex flex-col gap-5 border-b border-[var(--border-faint)] pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="fc-kicker mb-2 text-violet-400">Workspace</p>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
            Workflows
          </h1>
          <p className="mt-1.5 text-sm text-[var(--text-muted)]">
            Build, run, and manage your automation workflows.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="md" onClick={openAIModal}>
            ✦ Generate with AI
          </Button>
          <Button onClick={handleCreate} size="md">
            + New Workflow
          </Button>
        </div>
      </div>

      {error && (
        <div role="alert" className="mb-5 flex flex-wrap items-center justify-between gap-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          <span>{error}</span>
          <Button variant="ghost" size="sm" onClick={fetchWorkflows}>Retry</Button>
        </div>
      )}

      {/* Workflow grid */}
      {isLoading ? (
        <div role="status" aria-label="Loading workflows" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((item) => (
            <div key={item} className="h-48 animate-pulse rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-base)] p-5">
              <span className="block h-4 w-2/3 rounded bg-[var(--surface-hover)]" />
              <span className="mt-3 block h-3 w-full rounded bg-[var(--surface-raised)]" />
              <span className="mt-2 block h-3 w-4/5 rounded bg-[var(--surface-raised)]" />
              <span className="mt-5 block h-9 rounded-lg bg-[var(--surface-raised)]" />
            </div>
          ))}
          <span className="sr-only">Loading workflows...</span>
        </div>
      ) : (
        <WorkflowList
          workflows={workflows}
          onDelete={handleDelete}
          onCreate={handleCreate}
        />
      )}
      <AIGeneratorModal mode="create" />
    </PageLayout>
  );
}
