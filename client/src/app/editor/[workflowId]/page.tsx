'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ReactFlowProvider } from '@xyflow/react';
import { useWorkflowStore } from '@/stores/workflowStore';
import { NodePalette } from '@/features/workflow-canvas/NodePalette';
import { CanvasToolbar } from '@/features/workflow-canvas/CanvasToolbar';
import { WorkflowCanvas } from '@/features/workflow-canvas/WorkflowCanvas';
import { ConfigPanel } from '@/features/node-config/ConfigPanel';
import { ExecutionPanel } from '@/features/execution-viewer/ExecutionPanel';
import { AIGeneratorModal } from '@/features/ai-generator/AIGeneratorModal';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import * as api from '@/lib/api';
import { MOCK_WORKFLOWS } from '@/lib/mockData';

type LoadState = 'loading' | 'ready' | 'error';

export default function EditorPage() {
  const params = useParams<{ workflowId: string }>();
  const setWorkflow = useWorkflowStore((s) => s.setWorkflow);
  const clearWorkflow = useWorkflowStore((s) => s.clearWorkflow);
  const [loadState, setLoadState] = useState<LoadState>('loading');

  useEffect(() => {
    async function loadWorkflow() {
      setLoadState('loading');

      if (params.workflowId === 'new') {
        // Don't clear if AI generation already loaded nodes into the store
        const currentNodes = useWorkflowStore.getState().nodes;
        if (currentNodes.length === 0) {
          clearWorkflow();
        }
        setLoadState('ready');
        return;
      }

      try {
        const workflow = await api.getWorkflow(params.workflowId);
        setWorkflow(workflow);
        setLoadState('ready');
      } catch {
        const mock = MOCK_WORKFLOWS.find((w) => w._id === params.workflowId);
        if (mock) {
          setWorkflow(mock);
          setLoadState('ready');
        } else {
          clearWorkflow();
          setLoadState('error');
        }
      }
    }

    loadWorkflow();

    // Don't clear on unmount — preserves store state during navigation
    return () => {};
  }, [params.workflowId, setWorkflow, clearWorkflow]);

  // ── Error state ──────────────────────────────────────────
  if (loadState === 'error') {
    return (
      <div className="flex flex-1 items-center justify-center">
        <EmptyState
          icon="⚠"
          title="Workflow not found"
          description="This workflow doesn't exist or couldn't be loaded."
          action={<Button href="/dashboard">Back to Dashboard</Button>}
        />
      </div>
    );
  }

  return (
    <ReactFlowProvider>
      <div className="flex flex-1 flex-col overflow-hidden">
        <CanvasToolbar />

        <div className="flex flex-1 overflow-hidden">
          <NodePalette />

          <div className="flex flex-1 flex-col overflow-hidden">
            {loadState === 'loading' ? (
              <div className="flex flex-1 items-center justify-center bg-zinc-50 dark:bg-zinc-950">
                <span className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600" />
              </div>
            ) : (
              <WorkflowCanvas />
            )}
            <ExecutionPanel />
          </div>

          <ConfigPanel />
        </div>
      </div>
      <AIGeneratorModal />
    </ReactFlowProvider>
  );
}
