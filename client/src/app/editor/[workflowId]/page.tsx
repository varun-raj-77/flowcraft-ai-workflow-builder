'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ReactFlowProvider } from '@xyflow/react';
import { useWorkflowStore } from '@/stores/workflowStore';
import { useUIStore } from '@/stores/uiStore';
import { useExecutionStore } from '@/stores/executionStore';
import { useRevisionHistoryStore } from '@/stores/revisionHistoryStore';
import { useRevisionComparisonStore } from '@/stores/revisionComparisonStore';
import { NodePalette } from '@/features/workflow-canvas/NodePalette';
import { CanvasToolbar } from '@/features/workflow-canvas/CanvasToolbar';
import { WorkflowCanvas } from '@/features/workflow-canvas/WorkflowCanvas';
import { ConfigPanel } from '@/features/node-config/ConfigPanel';
import { ExecutionPanel } from '@/features/execution-viewer/ExecutionPanel';
import { AIGeneratorModal } from '@/features/ai-generator/AIGeneratorModal';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { HistoricalRevisionBanner } from '@/features/revision-history/HistoricalRevisionBanner';
import { RevisionHistoryPanel } from '@/features/revision-history/RevisionHistoryPanel';
import { RevisionComparisonBanner } from '@/features/revision-comparison/RevisionComparisonBanner';
import { RevisionComparisonPanel } from '@/features/revision-comparison/RevisionComparisonPanel';
import * as api from '@/lib/api';

type LoadState = 'loading' | 'ready' | 'error';

export default function EditorPage() {
  const params = useParams<{ workflowId: string }>();
  const setWorkflow = useWorkflowStore((s) => s.setWorkflow);
  const clearWorkflow = useWorkflowStore((s) => s.clearWorkflow);
  const isInspectorMaximized = useUIStore((s) => s.isExecutionInspectorMaximized);
  const isHistorical = useRevisionHistoryStore((s) => s.previewRevision !== null);
  const resetRevisionHistory = useRevisionHistoryStore((s) => s.reset);
  const isComparing = useRevisionComparisonStore((s) => s.comparison !== null);
  const resetRevisionComparison = useRevisionComparisonStore((s) => s.reset);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    async function loadWorkflow() {
      resetRevisionHistory();
      resetRevisionComparison();
      useUIStore.getState().selectNode(null);
      useUIStore.getState().closeAIModal();
      setLoadState('loading');
      setLoadError('');

      if (params.workflowId === 'new') {
        // Generated graphs may be retained, but execution state is never shared.
        useExecutionStore.getState().clearExecution();
        useExecutionStore.getState().clearHistory();
        const currentNodes = useWorkflowStore.getState().nodes;
        if (currentNodes.length === 0) {
          clearWorkflow();
        }
        setLoadState('ready');
        return;
      }

      try {
        useExecutionStore.getState().clearExecution();
        useExecutionStore.getState().clearHistory();
        const workflow = await api.getWorkflow(params.workflowId);
        setWorkflow(workflow);
        setLoadState('ready');
      } catch (error) {
        clearWorkflow();
        setLoadError(api.getApiErrorMessage(error, 'This workflow could not be loaded.'));
        setLoadState('error');
      }
    }

    void loadWorkflow();

    // Don't clear on unmount — preserves store state during navigation
    return () => {};
  }, [params.workflowId, setWorkflow, clearWorkflow, resetRevisionHistory, resetRevisionComparison]);

  // ── Error state ──────────────────────────────────────────
  if (loadState === 'error') {
    return (
      <div className="flex flex-1 items-center justify-center">
        <EmptyState
          icon="⚠"
          title="Workflow not found"
          description={loadError || "This workflow doesn't exist or couldn't be loaded."}
          action={<Button href="/dashboard">Back to Dashboard</Button>}
        />
      </div>
    );
  }

  return (
    <ReactFlowProvider>
      <div className="flex flex-1 flex-col overflow-hidden">
        <CanvasToolbar />
        <HistoricalRevisionBanner />
        <RevisionComparisonBanner />

        <div className="flex flex-1 overflow-hidden">
          {!isInspectorMaximized && !isHistorical && !isComparing && <NodePalette />}

          <div className="flex flex-1 flex-col overflow-hidden">
            {!isInspectorMaximized && (loadState === 'loading' ? (
              <div className="flex flex-1 items-center justify-center bg-zinc-50 dark:bg-zinc-950">
                <span className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600" />
              </div>
            ) : (
              <WorkflowCanvas />
            ))}
            <ExecutionPanel />
          </div>

          {!isInspectorMaximized && (isComparing ? <RevisionComparisonPanel /> : <ConfigPanel />)}
        </div>
      </div>
      <AIGeneratorModal mode="current-workflow" />
      <RevisionHistoryPanel />
    </ReactFlowProvider>
  );
}
