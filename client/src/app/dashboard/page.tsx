'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
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

type PendingCreation = { status: 'creating' } | { status: 'opening'; workflowId: string };

export default function DashboardPage() {
  const router = useRouter();
  const openAIModal = useUIStore((s) => s.openAIModal);
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creation, setCreation] = useState<PendingCreation | null>(null);
  const createPending = useRef(false);
  const dashboardActive = useRef(false);

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
    dashboardActive.current = true;
    void fetchWorkflows();
    return () => { dashboardActive.current = false; };
  }, [fetchWorkflows]);

  // Create a new empty workflow
  async function handleCreate() {
    // Both entry points share the lock, which also covers the interval
    // between the server acknowledging creation and the editor opening.
    if (createPending.current) return;
    createPending.current = true;
    const pathname = window.location.pathname;
    const stillOnDashboard = () => dashboardActive.current && window.location.pathname === pathname;
    setCreateError(null);
    setCreation({ status: 'creating' });
    let workflowId: string;

    try {
      const workflow = await api.createWorkflow({ name: 'Untitled Workflow' });
      workflowId = workflow._id;
    } catch (err) {
      createPending.current = false;
      if (!stillOnDashboard()) return;
      setCreation(null);
      const unconfirmed = !(err instanceof api.ApiError) || err.status >= 500 || err.code === 'INVALID_RESPONSE';
      setCreateError(unconfirmed
        ? 'The server did not confirm creation. Refresh the list to check for the new workflow before trying again.'
        : api.getApiErrorMessage(err, 'Unable to create a workflow.'));
      return;
    }

    // The write may have completed even when the user navigated away.
    // Leave it in the workspace without pulling them back into the editor.
    if (!stillOnDashboard()) return;
    setCreation({ status: 'opening', workflowId });
    router.push(`/editor/${workflowId}`);
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
          <Button variant="ghost" size="md" onClick={openAIModal} disabled={creation !== null}>
            ✦ Generate with AI
          </Button>
          <Button onClick={handleCreate} size="md" isLoading={creation?.status === 'creating'} disabled={creation !== null}>
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

      {createError && (
        <div role="alert" className="mb-5 flex flex-wrap items-center justify-between gap-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          <span>{createError}</span>
          <Button variant="ghost" size="sm" onClick={() => { setCreateError(null); void fetchWorkflows(); }}>Refresh list</Button>
        </div>
      )}
      {creation?.status === 'opening' && (
        <div role="status" className="mb-5 flex flex-wrap items-center gap-3 text-sm text-[var(--text-secondary)]">
          <span>Workflow created. Opening the editor…</span>
          <Button href={`/editor/${creation.workflowId}`} variant="secondary" size="sm">Open new workflow</Button>
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
          createDisabled={creation !== null}
          createPending={creation?.status === 'creating'}
        />
      )}
      <AIGeneratorModal mode="create" />
    </PageLayout>
  );
}
