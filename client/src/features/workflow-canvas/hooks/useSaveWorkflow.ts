import { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useWorkflowStore } from '@/stores/workflowStore';
import * as api from '@/lib/api';
import { withNormalizedGenerationMetadata } from '@/lib/workflowSavePayload';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export function useSaveWorkflow() {
  const router = useRouter();
  const meta = useWorkflowStore((s) => s.meta);
  const toWorkflowNodes = useWorkflowStore((s) => s.toWorkflowNodes);
  const toWorkflowEdges = useWorkflowStore((s) => s.toWorkflowEdges);
  const setWorkflow = useWorkflowStore((s) => s.setWorkflow);

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

  const save = useCallback(async (): Promise<void> => {
    if (isSavingRef.current) return;

    isSavingRef.current = true;
    clearStatusTimer();
    setStatus('saving');

    try {
      const nodes = toWorkflowNodes();
      const edges = toWorkflowEdges();

      if (meta?._id) {
        const saved = await api.updateWorkflow(meta._id, withNormalizedGenerationMetadata({
          name: meta.name,
          description: meta.description,
          nodes,
          edges,
        }, meta.generationMetadata));
        setWorkflow(saved);
      } else {
        const created = await api.createWorkflow(withNormalizedGenerationMetadata({
          name: meta?.name || 'Untitled Workflow',
          description: meta?.description,
          nodes,
          edges,
          isGeneratedByAI: meta?.isGeneratedByAI,
        }, meta?.generationMetadata));
        setWorkflow(created);
        router.replace(`/editor/${created._id}`);
      }

      if (isMountedRef.current) setStatus('saved');
      resetStatusAfter(2000);
    } catch (err) {
      if (isMountedRef.current) setStatus('error');
      resetStatusAfter(3000);
      throw err;
    } finally {
      isSavingRef.current = false;
    }
  }, [clearStatusTimer, meta, resetStatusAfter, toWorkflowNodes, toWorkflowEdges, setWorkflow, router]);

  return { save, status };
}
