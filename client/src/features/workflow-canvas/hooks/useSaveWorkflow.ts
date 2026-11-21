import { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useWorkflowStore } from '@/stores/workflowStore';
import * as api from '@/lib/api';
import { withNormalizedGenerationMetadata } from '@/lib/workflowSavePayload';
import { useRevisionHistoryStore } from '@/stores/revisionHistoryStore';
import { useRevisionComparisonStore } from '@/stores/revisionComparisonStore';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export function useSaveWorkflow() {
  const router = useRouter();

  const [status, setStatus] = useState<SaveStatus>('idle');
  const isSavingRef = useRef(false);
  const isMountedRef = useRef(true);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearStatusTimer = useCallback(() => {
    if (statusTimerRef.current) {
      clearTimeout(statusTimerRef.current);
      statusTimerRef.current = null;
    }
  }, []);

  const resetStatusAfter = useCallback((delayMs: number) => {
    if (!isMountedRef.current) return;
    clearStatusTimer();
    statusTimerRef.current = setTimeout(() => {
      setStatus('idle');
      statusTimerRef.current = null;
    }, delayMs);
  }, [clearStatusTimer]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      clearStatusTimer();
    };
  }, [clearStatusTimer]);

  const save = useCallback(async (): Promise<boolean> => {
    if (isSavingRef.current) return false;
    if (useRevisionHistoryStore.getState().previewRevision || useRevisionComparisonStore.getState().comparison) {
      throw new api.ApiError(
        409,
        'HISTORICAL_PREVIEW_READ_ONLY',
        'Return to the current revision before saving.',
      );
    }

    isSavingRef.current = true;
    clearStatusTimer();
    setStatus('saving');

    try {
      const submitted = useWorkflowStore.getState();
      const { meta } = submitted;
      const pathname = window.location.pathname;
      const nodes = submitted.toWorkflowNodes();
      const edges = submitted.toWorkflowEdges();

      if (meta?._id) {
        if (!meta.currentRevision) {
          throw new api.ApiError(409, 'WORKFLOW_MIGRATION_REQUIRED', 'This workflow must be migrated before it can be saved.');
        }
        const saved = await api.updateWorkflow(meta._id, withNormalizedGenerationMetadata({
          expectedRevision: meta.currentRevision,
          name: meta.name,
          description: meta.description,
          nodes,
          edges,
        }, meta.generationMetadata));
        if (!isMountedRef.current) return false;
        if (window.location.pathname !== pathname || !submitted.acknowledgeWorkflowUpdate(saved, submitted)) {
          setStatus('idle');
          return false;
        }
      } else {
        const created = await api.createWorkflow(withNormalizedGenerationMetadata({
          name: meta?.name || 'Untitled Workflow',
          description: meta?.description,
          nodes,
          edges,
          isGeneratedByAI: meta?.isGeneratedByAI,
        }, meta?.generationMetadata));
        submitted.setWorkflow(created);
        router.replace(`/editor/${created._id}`);
      }

      if (isMountedRef.current) setStatus(useWorkflowStore.getState().isDirty ? 'idle' : 'saved');
      resetStatusAfter(2000);
      return true;
    } catch (err) {
      if (isMountedRef.current) setStatus('error');
      resetStatusAfter(3000);
      throw err;
    } finally {
      isSavingRef.current = false;
    }
  }, [clearStatusTimer, resetStatusAfter, router]);

  return { save, status };
}
