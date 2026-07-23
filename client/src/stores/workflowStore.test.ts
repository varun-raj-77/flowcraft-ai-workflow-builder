import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkflowStore } from './workflowStore';
import type { FlowNodeData, Workflow } from '@/types';
import type { Edge, Node } from '@xyflow/react';

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

  it('undoes and redoes an added node with one bounded history entry', () => {
    useWorkflowStore.getState().setWorkflow(workflow);
    const nodeId = useWorkflowStore.getState().addNode('end', { x: 100, y: 0 });
    expect(useWorkflowStore.getState().nodes.some((node) => node.id === nodeId)).toBe(true);
    expect(useWorkflowStore.getState().undoStack).toHaveLength(1);

    useWorkflowStore.getState().undo();
    expect(useWorkflowStore.getState().nodes).toHaveLength(1);
    expect(useWorkflowStore.getState().isDirty).toBe(false);

    useWorkflowStore.getState().redo();
    expect(useWorkflowStore.getState().nodes.some((node) => node.id === nodeId)).toBe(true);
    expect(useWorkflowStore.getState().isDirty).toBe(true);
  });

  it('restores exact node and edge data after a safe linear reconnect delete', () => {
    const nodes: Node<FlowNodeData>[] = [
      { id: 'a', type: 'start', position: { x: 0, y: 0 }, data: { label: 'A', nodeType: 'start', config: {} } },
      { id: 'b', type: 'transform', position: { x: 100, y: 0 }, data: { label: 'B', nodeType: 'transform', config: { transformCode: 'return data' } } },
      { id: 'c', type: 'end', position: { x: 200, y: 0 }, data: { label: 'C', nodeType: 'end', config: {} } },
    ];
    const edges: Edge[] = [
      { id: 'a-b', source: 'a', target: 'b', type: 'smoothstep', data: { conditionBranch: undefined } },
      { id: 'b-c', source: 'b', target: 'c', type: 'smoothstep', data: { conditionBranch: undefined } },
    ];
    useWorkflowStore.setState({ nodes, edges, meta: { _id: 'workflow_1', name: 'Saved workflow', isGeneratedByAI: false }, savedSnapshot: { nodes, edges, meta: { _id: 'workflow_1', name: 'Saved workflow', isGeneratedByAI: false } }, undoStack: [], redoStack: [], isDirty: false });

    useWorkflowStore.getState().removeNodeAndReconnect('b', { source: 'a', target: 'c', sourceHandle: null, targetHandle: null });
    expect(useWorkflowStore.getState().edges).toHaveLength(1);
    useWorkflowStore.getState().undo();
    expect(useWorkflowStore.getState().nodes).toEqual(nodes);
    expect(useWorkflowStore.getState().edges).toEqual(edges);
    useWorkflowStore.getState().redo();
    expect(useWorkflowStore.getState().nodes.map((node) => node.id)).toEqual(['a', 'c']);
  });

  it('coalesces a drag gesture and clears redo after a new edit', () => {
    useWorkflowStore.getState().setWorkflow(workflow);
    useWorkflowStore.getState().onNodesChange([{ type: 'position', id: 'start', position: { x: 10, y: 0 }, dragging: true }]);
    useWorkflowStore.getState().onNodesChange([{ type: 'position', id: 'start', position: { x: 20, y: 0 }, dragging: true }]);
    useWorkflowStore.getState().onNodesChange([{ type: 'position', id: 'start', position: { x: 30, y: 0 }, dragging: false }]);
    expect(useWorkflowStore.getState().undoStack).toHaveLength(1);
    useWorkflowStore.getState().undo();
    expect(useWorkflowStore.getState().nodes[0].position.x).toBe(0);
    expect(useWorkflowStore.getState().redoStack).toHaveLength(1);
    useWorkflowStore.getState().addNode('end', { x: 50, y: 0 });
    expect(useWorkflowStore.getState().redoStack).toHaveLength(0);
  });

  it('keeps history workflow-scoped, bounded, and free of execution state', () => {
    useWorkflowStore.getState().setWorkflow(workflow);
    for (let index = 0; index < 45; index += 1) useWorkflowStore.getState().addNode('output', { x: index, y: 0 });
    expect(useWorkflowStore.getState().undoStack).toHaveLength(40);
    useWorkflowStore.getState().clearWorkflow();
    expect(useWorkflowStore.getState().undoStack).toHaveLength(0);
    expect(useWorkflowStore.getState().redoStack).toHaveLength(0);
    expect(useWorkflowStore.getState().isDirty).toBe(false);
  });

  it('treats a complete AI generation as one atomic undoable replacement', () => {
    useWorkflowStore.getState().setWorkflow(workflow);
    const metadata = { originalPrompt: 'Create a workflow', generatedAt: '2026-01-01T00:00:00.000Z', capabilityCoverage: { requestedCapabilities: [], implementedCapabilities: [], missingCapabilities: [], unsupportedCapabilities: [], coverage: 1, isComplete: true } };
    useWorkflowStore.getState().applyGeneratedWorkflow({ name: 'Generated', nodes: [], edges: [], generationMetadata: metadata });
    expect(useWorkflowStore.getState().meta?.generationMetadata).toEqual(metadata);
    useWorkflowStore.getState().undo();
    expect(useWorkflowStore.getState().meta?.name).toBe('Saved workflow');
    useWorkflowStore.getState().redo();
    expect(useWorkflowStore.getState().meta?.generationMetadata).toEqual(metadata);
  });
});
