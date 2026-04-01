import { useCallback, useRef } from 'react';
import { useWorkflowStore } from '@/stores/workflowStore';
import { useExecutionStore } from '@/stores/executionStore';
import { useUIStore } from '@/stores/uiStore';
import { useSaveWorkflow } from './useSaveWorkflow';
import { useExecutionSocket } from '@/features/execution-viewer/hooks/useExecutionSocket';
import * as api from '@/lib/api';

export function useRunWorkflow() {
  const meta = useWorkflowStore((s) => s.meta);
  const isDirty = useWorkflowStore((s) => s.isDirty);
  const setCurrentRun = useExecutionStore((s) => s.setCurrentRun);
  const isRunning = useExecutionStore((s) => s.isRunning);
  const { save } = useSaveWorkflow();
  const { joinRun } = useExecutionSocket();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPolling = useCallback((runId: string) => {
    stopPolling();

    // Poll every 2 seconds until the run is no longer 'running'
    pollRef.current = setInterval(async () => {
      try {
        const run = await api.getExecution(runId);
        setCurrentRun(run);

        if (run.status !== 'running') {
          stopPolling();
        }
      } catch {
        // Ignore poll errors — will retry on next interval
      }
    }, 2000);

    // Safety: stop polling after 60 seconds max
    setTimeout(() => stopPolling(), 60000);
  }, [setCurrentRun, stopPolling]);

  const run = useCallback(async () => {
    if (isRunning) return;

    let workflowId = meta?._id;

    if (!workflowId || isDirty) {
      await save();
      workflowId = useWorkflowStore.getState().meta?._id;
    }

    if (!workflowId) {
      console.error('[run] Cannot execute: no workflow ID');
      return;
    }

    // Open the execution panel
    const uiState = useUIStore.getState();
    if (!uiState.isExecutionPanelOpen) {
      uiState.toggleExecutionPanel();
    }

    try {
      const fullRun = await api.runWorkflow(workflowId);
      setCurrentRun(fullRun);

      // Try socket for real-time updates
      joinRun(fullRun._id);

      // Also start polling as a fallback — ensures UI updates even if socket fails
      startPolling(fullRun._id);
    } catch (err) {
      console.error('[run] Execution failed:', err);
    }
  }, [meta, isDirty, isRunning, save, setCurrentRun, joinRun, startPolling]);

  return { run, isRunning };
}
