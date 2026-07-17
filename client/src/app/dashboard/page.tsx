'use client';

import { useState, useEffect, useCallback } from 'react';
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
    fetchWorkflows();
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
      fetchWorkflows();
      setError(api.getApiErrorMessage(err, 'Unable to delete the workflow. Please try again.'));
    }
  }

  return (
    <PageLayout>
      {/* Page header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
            Workflows
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Build, run, and manage your automation workflows.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="md" onClick={openAIModal}>
            ✦ Generate with AI
          </Button>
          <Button onClick={handleCreate} size="md">
            + New Workflow
          </Button>
        </div>
      </div>

      {error && (
        <div className="mb-5 flex items-center justify-between gap-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
          <span>{error}</span>
          <Button variant="ghost" size="sm" onClick={fetchWorkflows}>Retry</Button>
        </div>
      )}

      {/* Workflow grid */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600" />
        </div>
      ) : (
        <WorkflowList
          workflows={workflows}
          onDelete={handleDelete}
          onCreate={handleCreate}
        />
      )}
      <AIGeneratorModal />
    </PageLayout>
  );
}
