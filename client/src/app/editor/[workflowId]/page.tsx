'use client';

import React, { useEffect, useRef, useState } from 'react';
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
import { useWarnOnPageExit } from '@/features/workflow-canvas/hooks/useWarnOnPageExit';
import { ConfigPanel } from '@/features/node-config/ConfigPanel';
import { ExecutionPanel } from '@/features/execution-viewer/ExecutionPanel';
import { TestLabPanel } from '@/features/test-lab/TestLabPanel';
import { AIGeneratorModal } from '@/features/ai-generator/AIGeneratorModal';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { HistoricalRevisionBanner } from '@/features/revision-history/HistoricalRevisionBanner';
import { RevisionHistoryPanel } from '@/features/revision-history/RevisionHistoryPanel';
import { RevisionComparisonBanner } from '@/features/revision-comparison/RevisionComparisonBanner';
import { RevisionComparisonPanel } from '@/features/revision-comparison/RevisionComparisonPanel';
import * as api from '@/lib/api';

type LoadState =
  | { status: 'loading' | 'ready' }
  | { status: 'error'; error: unknown };

export default function EditorPage() {
  useWarnOnPageExit();
  const { workflowId } = useParams<{ workflowId: string }>();
  // A new route must start hidden even before its load effect runs. The
  // Zustand stores survive the route change for the first-save handoff.
  return <WorkflowEditor key={workflowId} workflowId={workflowId} />;
}

function WorkflowEditor({ workflowId }: { workflowId: string }) {
  const setWorkflow = useWorkflowStore((s) => s.setWorkflow);
  const clearWorkflow = useWorkflowStore((s) => s.clearWorkflow);
  const isInspectorMaximized = useUIStore((s) => s.isExecutionInspectorMaximized);
  const isHistorical = useRevisionHistoryStore((s) => s.previewRevision !== null);
  const resetRevisionHistory = useRevisionHistoryStore((s) => s.reset);
  const isComparing = useRevisionComparisonStore((s) => s.comparison !== null);
  const resetRevisionComparison = useRevisionComparisonStore((s) => s.reset);
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' });
  const [loadAttempt, setLoadAttempt] = useState(0);
  const acceptedHandoff = useRef<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function loadWorkflow() {
      const editorState = useWorkflowStore.getState();
      // Creation already loaded the saved revision and may have held onto a
      // newer draft. Only this same-ID promotion skips the ordinary GET.
      if (editorState.consumeCreatedWorkflowHandoff(workflowId) ||
          (acceptedHandoff.current === workflowId && editorState.meta?._id === workflowId)) {
        // Keep effect replays on this mount (including Strict Mode) idempotent.
        acceptedHandoff.current = workflowId;
        setLoadState({ status: 'ready' });
        return;
      }
      acceptedHandoff.current = null;
      resetRevisionHistory();
      resetRevisionComparison();
      useUIStore.getState().selectNode(null);
      useUIStore.getState().closeAIModal();
      useUIStore.getState().closeTestLab();
      if (workflowId === 'new') {
        // Generated graphs may be retained, but execution state is never shared.
        useExecutionStore.getState().clearExecution();
        useExecutionStore.getState().clearHistory();
        const editorState = useWorkflowStore.getState();
        // Keep a staged unsaved draft, but never reuse a persisted workflow's
        // revision or ID when the URL explicitly requests a new workflow.
        if (editorState.meta?._id || editorState.nodes.length === 0) {
          clearWorkflow();
        }
        setLoadState({ status: 'ready' });
        return;
      }

      try {
        useExecutionStore.getState().clearExecution();
        useExecutionStore.getState().clearHistory();
        const workflow = await api.getWorkflow(workflowId, controller.signal);
        if (controller.signal.aborted) return;
        setWorkflow(workflow);
        setLoadState({ status: 'ready' });
      } catch (error) {
        if (controller.signal.aborted) return;
        clearWorkflow();
        setLoadState({ status: 'error', error });
      }
    }

    void loadWorkflow();

    return () => controller.abort();
  }, [workflowId, loadAttempt, setWorkflow, clearWorkflow, resetRevisionHistory, resetRevisionComparison]);

  if (loadState.status === 'loading') {
    return (
      <div role="status" className="flex flex-1 items-center justify-center gap-3 bg-[var(--surface-base)] text-sm text-[var(--text-muted)]">
        <span aria-hidden="true" className="h-5 w-5 motion-safe:animate-spin rounded-full border-2 border-current border-t-transparent" />
        Loading workflow…
      </div>
    );
  }

  if (loadState.status === 'error') {
    const { error } = loadState;
    const status = error instanceof api.ApiError ? error.status : undefined;
    const terminal = status !== undefined && [400, 401, 403, 404, 410, 422].includes(status);
    const title = status === 404 || status === 410 ? 'Workflow not found' : 'Could not load workflow';
    const canSignIn = status === 401;
    const retry = () => {
      setLoadState({ status: 'loading' });
      setLoadAttempt((attempt) => attempt + 1);
    };
    return (
      <div className="flex flex-1 items-center justify-center">
        <EmptyState
          icon="⚠"
          title={title}
          description={api.getApiErrorMessage(error, 'This workflow could not be loaded.')}
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              {!terminal && <Button onClick={retry}>Try again</Button>}
              {canSignIn ? <Button href="/login">Sign in</Button> : (
                <Button variant={terminal ? 'primary' : 'secondary'} href="/dashboard">Back to Dashboard</Button>
              )}
            </div>
          }
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
            {!isInspectorMaximized && <WorkflowCanvas />}
            <ExecutionPanel />
          </div>

          {!isInspectorMaximized && (isComparing ? <RevisionComparisonPanel /> : <ConfigPanel />)}
        </div>
      </div>
      <AIGeneratorModal mode="current-workflow" />
      <RevisionHistoryPanel />
      <TestLabPanel />
    </ReactFlowProvider>
  );
}
