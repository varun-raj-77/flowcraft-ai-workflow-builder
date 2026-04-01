'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { PageLayout } from '@/components/layout/PageLayout';
import { Button } from '@/components/ui/Button';
import { WorkflowList } from '@/features/workflow-manager/WorkflowList';
import { AIGeneratorModal } from '@/features/ai-generator/AIGeneratorModal';
import { useUIStore } from '@/stores/uiStore';
import * as api from '@/lib/api';
import { MOCK_WORKFLOWS } from '@/lib/mockData';
import type { Workflow } from '@/types';

export default function DashboardPage() {
  const router = useRouter();
  const openAIModal = useUIStore((s) => s.openAIModal);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch workflows on mount
  const fetchWorkflows = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await api.listWorkflows();
      setWorkflows(data);
    } catch {
      // API unavailable — fall back to mock data for frontend-only dev
      console.warn('[dashboard] API unavailable, using mock data');
      setWorkflows(MOCK_WORKFLOWS);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWorkflows();
  }, [fetchWorkflows]);

  // Create a new empty workflow
  async function handleCreate() {
    try {
      const workflow = await api.createWorkflow({ name: 'Untitled Workflow' });
      router.push(`/editor/${workflow._id}`);
    } catch {
      // API unavailable — navigate to a "new" editor
      router.push('/editor/new');
    }
  }

  // Delete a workflow
  async function handleDelete(id: string) {
    // Optimistic update — remove from UI immediately
    setWorkflows((prev) => prev.filter((w) => w._id !== id));
    try {
      await api.deleteWorkflow(id);
    } catch {
      // Revert on failure
      fetchWorkflows();
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
