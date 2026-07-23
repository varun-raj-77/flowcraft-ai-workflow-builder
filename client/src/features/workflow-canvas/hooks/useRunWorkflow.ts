import { useCallback, useEffect, useRef } from 'react';
import { useWorkflowStore } from '@/stores/workflowStore';
import { useExecutionStore } from '@/stores/executionStore';
import { useUIStore } from '@/stores/uiStore';
import { useSaveWorkflow } from './useSaveWorkflow';
import { useExecutionSocket } from '@/features/execution-viewer/hooks/useExecutionSocket';
import * as api from '@/lib/api';
import { validateWorkflowPreflight } from '../workflowPreflight';

export function useRunWorkflow() {
  const meta = useWorkflowStore((s) => s.meta);
  const isDirty = useWorkflowStore((s) => s.isDirty);
  const setCurrentRun = useExecutionStore((s) => s.setCurrentRun);
  const setLastError = useExecutionStore((s) => s.setLastError);
  const isRunning = useExecutionStore((s) => s.isRunning);
  const { save } = useSaveWorkflow();
  const { joinRun, prepareSocket } = useExecutionSocket();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const startPolling = useCallback((runId: string) => {
    stopPolling();

    // Poll every 2 seconds until the run is no longer 'running'
    pollRef.current = setInterval(() => {
      void api.getExecution(runId).then((run) => {
        if (useWorkflowStore.getState().meta?._id !== run.workflowId) {
          stopPolling();
          return;
        }
        setCurrentRun(run);

        if (run.status !== 'running') {
          stopPolling();
        }
      }).catch(() => {
        // Ignore poll errors — will retry on next interval
      });
    }, 2000);

    // Safety: stop polling after 60 seconds max
    pollTimeoutRef.current = setTimeout(() => stopPolling(), 60000);
  }, [setCurrentRun, stopPolling]);

  const run = useCallback(async () => {
    if (isRunning) return;

    try {
      const preflight = validateWorkflowPreflight(useWorkflowStore.getState().nodes, useWorkflowStore.getState().edges);
      const errors = preflight.filter((finding) => finding.severity === 'error');
      if (errors.length) {
        setLastError(`Workflow Preflight found ${errors.length} issue${errors.length === 1 ? '' : 's'}. Resolve them before running.`);
        return;
      }
      setLastError(null);
      let workflowId = meta?._id;

      if (!workflowId || isDirty) {
        await save();
        workflowId = useWorkflowStore.getState().meta?._id;
      }

      if (!workflowId) {
        throw new Error('Save the workflow before running it.');
      }

      // Validate the live-update endpoint before creating a run. This keeps a
      // configuration failure from leaving a new run displayed as pending.
      prepareSocket();

      // Open the execution panel only after persistence succeeds.
      const uiState = useUIStore.getState();
      if (!uiState.isExecutionPanelOpen) {
        uiState.toggleExecutionPanel();
      }

      const fullRun = await api.runWorkflow(workflowId);
      setCurrentRun(fullRun);

      // Try socket for real-time updates
      joinRun(fullRun._id);

      // Also start polling as a fallback — ensures UI updates even if socket fails
      startPolling(fullRun._id);
    } catch (err) {
      setLastError(api.getApiErrorMessage(err, 'Unable to run this workflow. Please try again.'));
    }
  }, [meta, isDirty, isRunning, save, setCurrentRun, setLastError, joinRun, prepareSocket, startPolling]);

  return { run, isRunning };
}
