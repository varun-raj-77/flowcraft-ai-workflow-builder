import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkflowStore } from './workflowStore';
import type { Workflow } from '@/types';

const workflow: Workflow = { _id: 'workflow_1', userId: 'user_1', name: 'Saved workflow', nodes: [{ id: 'start', type: 'start', label: 'Start', position: { x: 0, y: 0 }, config: {} }], edges: [], isGeneratedByAI: true, generationMetadata: { originalPrompt: 'Fetch data', generatedAt: '2026-01-01T00:00:00.000Z' }, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };

describe('workflow dirty-state contract', () => {
  beforeEach(() => useWorkflowStore.getState().clearWorkflow());
  it('hydrates and reopens saved workflows cleanly', () => {
    useWorkflowStore.getState().setWorkflow(workflow);
    expect(useWorkflowStore.getState().isDirty).toBe(false);
    useWorkflowStore.getState().setWorkflow(workflow);
    expect(useWorkflowStore.getState().isDirty).toBe(false);
  });
  it('does not dirty for canvas selection or dimensions', () => {
    useWorkflowStore.getState().setWorkflow(workflow);
    useWorkflowStore.getState().onNodesChange([{ type: 'select', id: 'start', selected: true }, { type: 'dimensions', id: 'start', dimensions: { width: 100, height: 40 } }]);
    expect(useWorkflowStore.getState().isDirty).toBe(false);
  });
  it('dirties persisted graph, metadata, and node changes', () => {
    useWorkflowStore.getState().setWorkflow(workflow);
    useWorkflowStore.getState().onNodesChange([{ type: 'position', id: 'start', position: { x: 10, y: 0 } }]);
    expect(useWorkflowStore.getState().isDirty).toBe(true);
    useWorkflowStore.getState().setWorkflow(workflow);
    useWorkflowStore.getState().updateMeta({ generationMetadata: { originalPrompt: 'Changed prompt', generatedAt: '2026-01-01T00:00:00.000Z' } });
    expect(useWorkflowStore.getState().isDirty).toBe(true);
  });

  it('does not replace the graph or metadata after an incomplete AI generation', () => {
    useWorkflowStore.getState().setWorkflow(workflow);

    useWorkflowStore.getState().applyGeneratedWorkflow({
      name: 'Incomplete replacement',
      nodes: [],
      edges: [],
      generationMetadata: { originalPrompt: 'Try again', generatedAt: '2026-01-01T00:00:00.000Z' },
    });

    expect(useWorkflowStore.getState().nodes).toHaveLength(1);
    expect(useWorkflowStore.getState().meta?.name).toBe('Saved workflow');
    expect(useWorkflowStore.getState().meta?.generationMetadata).toEqual(workflow.generationMetadata);
  });
});
