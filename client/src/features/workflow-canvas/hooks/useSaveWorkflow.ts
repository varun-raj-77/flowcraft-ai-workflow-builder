import { useState, useCallback } from 'react';
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

  const save = useCallback(async (): Promise<void> => {
    if (status === 'saving') return; // Prevent double-save

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

      setStatus('saved');
      setTimeout(() => setStatus('idle'), 2000);
    } catch (err) {
      console.error('[save] Failed:', err);
      setStatus('error');
      setTimeout(() => setStatus('idle'), 3000);
      throw err;
    }
  }, [status, meta, toWorkflowNodes, toWorkflowEdges, setWorkflow, router]);

  return { save, status };
}
