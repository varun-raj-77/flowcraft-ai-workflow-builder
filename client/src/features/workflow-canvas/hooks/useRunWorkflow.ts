import { useCallback, useEffect } from 'react';
import { useWorkflowStore } from '@/stores/workflowStore';
import { useExecutionStore } from '@/stores/executionStore';
import { useUIStore } from '@/stores/uiStore';
import { useExecutionSocket } from '@/features/execution-viewer/hooks/useExecutionSocket';
import * as api from '@/lib/api';
import { validateWorkflowPreflight } from '../workflowPreflight';
import { useRevisionHistoryStore } from '@/stores/revisionHistoryStore';
import { useRevisionComparisonStore } from '@/stores/revisionComparisonStore';

export function useRunWorkflow(save: () => Promise<boolean>) {
  const setCurrentRun = useExecutionStore((s) => s.setCurrentRun);
  const setLastError = useExecutionStore((s) => s.setLastError);
  const isRunning = useExecutionStore((s) => s.isRunning);
  const isStarting = useExecutionStore((s) => s.runDispatchToken !== null);
  const activeRunId = useExecutionStore((s) => s.currentRun?._id);
  const activeRunWorkflowId = useExecutionStore((s) => s.currentRun?.workflowId);
  const editorWorkflowId = useWorkflowStore((s) => s.meta?._id);
  const { joinRun, leaveCurrentRoom, prepareSocket } = useExecutionSocket();

  // Socket ownership follows the active editor, which can remount when the
  // first save promotes /editor/new. ExecutionPanel separately reconciles
  // durable state by polling; don't start a second loop from the old toolbar.
  useEffect(() => {
    if (!isRunning || !activeRunId || activeRunWorkflowId !== editorWorkflowId) return;
    joinRun(activeRunId);
    return leaveCurrentRoom;
  }, [activeRunId, activeRunWorkflowId, editorWorkflowId, isRunning, joinRun, leaveCurrentRoom]);

  const run = useCallback(async () => {
    if (useRevisionHistoryStore.getState().previewRevision || useRevisionComparisonStore.getState().comparison) {
      setLastError('Return to the current revision before running this workflow.');
      return;
    }

    // The execution store survives only the legitimate first-save handoff:
    // ordinary workflow loads clear it, invalidating the pending start token.
    const execution = useExecutionStore.getState();
    const token = execution.beginRunDispatch();
    if (!token) return;
    const pathname = window.location.pathname;
    const { nodes, edges, meta, isDirty } = useWorkflowStore.getState();
    let workflowId = meta?._id;
    const canPromote = !workflowId && pathname === '/editor/new';
    const ownsEditor = () => {
      const currentPath = window.location.pathname;
      return useExecutionStore.getState().runDispatchToken === token
        && (currentPath === pathname || (canPromote && !!workflowId && currentPath === `/editor/${workflowId}`));
    };

    try {
      const preflight = validateWorkflowPreflight(nodes, edges);
      const errors = preflight.filter((finding) => finding.severity === 'error');
      if (errors.length) {
        setLastError(`Workflow Preflight found ${errors.length} issue${errors.length === 1 ? '' : 's'}. Resolve them before running.`);
        return;
      }
      setLastError(null);

      if (!workflowId || isDirty) {
        if (!await save()) return;
        const current = useWorkflowStore.getState();
        if (workflowId && current.meta?._id !== workflowId) return;
        workflowId = current.meta?._id;
        if (!ownsEditor()) return;
        if (current.isDirty) {
          setLastError('The workflow changed while saving. Save the latest edits before running.');
          return;
        }
      }

      if (!workflowId) {
        throw new Error('Save the workflow before running it.');
      }

      // Validate the live-update endpoint before creating a run. This keeps a
      // configuration failure from leaving a new run displayed as pending.
      prepareSocket();

      const uiState = useUIStore.getState();
      if (!uiState.isExecutionPanelOpen) uiState.setExecutionPanelOpen(true);

      const fullRun = await api.runWorkflow(workflowId);
      if (!ownsEditor() || fullRun.workflowId !== workflowId
        || useWorkflowStore.getState().meta?._id !== workflowId) return;
      setCurrentRun(fullRun);
    } catch (err) {
      if (ownsEditor()) {
        setLastError(api.getApiErrorMessage(err, 'Unable to run this workflow. Please try again.'));
      }
    } finally {
      execution.finishRunDispatch(token);
    }
  }, [save, setCurrentRun, setLastError, prepareSocket]);

  return { run, isRunning, isStarting };
}
