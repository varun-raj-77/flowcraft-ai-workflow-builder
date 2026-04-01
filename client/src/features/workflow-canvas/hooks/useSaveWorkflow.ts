import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useWorkflowStore } from '@/stores/workflowStore';
import * as api from '@/lib/api';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export function useSaveWorkflow() {
  const router = useRouter();
  const meta = useWorkflowStore((s) => s.meta);
  const toWorkflowNodes = useWorkflowStore((s) => s.toWorkflowNodes);
  const toWorkflowEdges = useWorkflowStore((s) => s.toWorkflowEdges);
  const setWorkflow = useWorkflowStore((s) => s.setWorkflow);
  const markClean = useWorkflowStore((s) => s.markClean);

  const [status, setStatus] = useState<SaveStatus>('idle');

  const save = useCallback(async () => {
    if (status === 'saving') return; // Prevent double-save

    setStatus('saving');

    try {
      const nodes = toWorkflowNodes();
      const edges = toWorkflowEdges();

      if (meta?._id) {
        await api.updateWorkflow(meta._id, {
          name: meta.name,
          description: meta.description,
          nodes,
          edges,
        });
      } else {
        const created = await api.createWorkflow({
          name: meta?.name || 'Untitled Workflow',
          description: meta?.description,
          nodes,
          edges,
        });
        setWorkflow(created);
        router.replace(`/editor/${created._id}`);
      }

      markClean();
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 2000);
    } catch (err) {
      console.error('[save] Failed:', err);
      setStatus('error');
      setTimeout(() => setStatus('idle'), 3000);
    }
  }, [status, meta, toWorkflowNodes, toWorkflowEdges, setWorkflow, markClean, router]);

  return { save, status };
}
