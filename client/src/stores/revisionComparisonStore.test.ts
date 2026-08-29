import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workflow, WorkflowRevisionComparison } from '@/types';
import { useUIStore } from './uiStore';
import { useWorkflowStore } from './workflowStore';
import { useRevisionHistoryStore } from './revisionHistoryStore';

const mocks = vi.hoisted(() => ({ compareWorkflowRevisions: vi.fn() }));

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/lib/api');
  return { ...actual, compareWorkflowRevisions: mocks.compareWorkflowRevisions };
});

import { useRevisionComparisonStore } from './revisionComparisonStore';

const workflow: Workflow = {
  _id: 'workflow-1',
  userId: 'user-1',
  name: 'Workflow',
  nodes: [
    { id: 'start', type: 'start', label: 'Start', position: { x: 0, y: 0 }, config: {} },
    { id: 'end', type: 'end', label: 'End', position: { x: 200, y: 0 }, config: {} },
  ],
  edges: [{ id: 'start-end', source: 'start', target: 'end' }],
  isGeneratedByAI: false,
  currentRevision: 2,
  currentRevisionId: 'revision-2',
  definitionHash: '2'.repeat(64),
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-02T00:00:00.000Z',
};

const comparison: WorkflowRevisionComparison = {
  workflowId: 'workflow-1',
  from: { id: 'revision-1', revision: 1, source: 'manual', definitionHash: '1'.repeat(64), createdAt: '2026-08-01T00:00:00.000Z' },
  to: { id: 'revision-2', revision: 2, source: 'manual', definitionHash: '2'.repeat(64), createdAt: '2026-08-02T00:00:00.000Z' },
  hasChanges: true,
  summary: { totalChanges: 1, nodes: { added: 0, removed: 0, modified: 1 }, edges: { added: 0, removed: 0, modified: 0 } },
  nodes: {
    added: [], removed: [],
    modified: [{
      nodeId: 'end',
      before: workflow.nodes[1],
      after: { ...workflow.nodes[1], label: 'Finished' },
      changes: [{ path: 'label', category: 'presentation', beforePresent: true, afterPresent: true, before: 'End', after: 'Finished' }],
      changesTruncated: false,
    }],
  },
  edges: { added: [], removed: [], modified: [] },
  graph: { nodes: [workflow.nodes[0], { ...workflow.nodes[1], label: 'Finished' }], edges: workflow.edges },
};

beforeEach(() => {
  useRevisionComparisonStore.getState().reset();
  useRevisionHistoryStore.getState().reset();
  useWorkflowStore.getState().setWorkflow(workflow);
  useUIStore.getState().selectNode(null);
  mocks.compareWorkflowRevisions.mockReset();
});

describe('revision comparison store isolation', () => {
  it('preserves the editable draft, dirty flag, saved snapshot, undo/redo, and selection exactly', async () => {
    useWorkflowStore.getState().updateNodeData('end', { label: 'First draft' });
    useWorkflowStore.getState().updateNodeData('end', { label: 'Second draft' });
    useWorkflowStore.getState().undo();
    useUIStore.getState().selectNode('end');
    const before = structuredClone({
      nodes: useWorkflowStore.getState().nodes,
      edges: useWorkflowStore.getState().edges,
      meta: useWorkflowStore.getState().meta,
      isDirty: useWorkflowStore.getState().isDirty,
      savedSnapshot: useWorkflowStore.getState().savedSnapshot,
      undoStack: useWorkflowStore.getState().undoStack,
      redoStack: useWorkflowStore.getState().redoStack,
    });
    mocks.compareWorkflowRevisions.mockResolvedValue(comparison);

    await useRevisionComparisonStore.getState().compare('workflow-1', 1, 2);

    expect(mocks.compareWorkflowRevisions).toHaveBeenCalledWith('workflow-1', 1, 2);
    expect(useRevisionComparisonStore.getState().comparison).toEqual(comparison);
    expect(useUIStore.getState().selectedNodeId).toBeNull();
    expect({
      nodes: useWorkflowStore.getState().nodes,
      edges: useWorkflowStore.getState().edges,
      meta: useWorkflowStore.getState().meta,
      isDirty: useWorkflowStore.getState().isDirty,
      savedSnapshot: useWorkflowStore.getState().savedSnapshot,
      undoStack: useWorkflowStore.getState().undoStack,
      redoStack: useWorkflowStore.getState().redoStack,
    }).toEqual(before);

    useUIStore.getState().selectNode('start');
    useRevisionComparisonStore.getState().exitComparison();
    expect(useUIStore.getState().selectedNodeId).toBe('end');
    expect({
      nodes: useWorkflowStore.getState().nodes,
      edges: useWorkflowStore.getState().edges,
      meta: useWorkflowStore.getState().meta,
      isDirty: useWorkflowStore.getState().isDirty,
      savedSnapshot: useWorkflowStore.getState().savedSnapshot,
      undoStack: useWorkflowStore.getState().undoStack,
      redoStack: useWorkflowStore.getState().redoStack,
    }).toEqual(before);
  });

  it('leaves the current editor active and exposes an error when comparison loading fails', async () => {
    useUIStore.getState().selectNode('start');
    mocks.compareWorkflowRevisions.mockRejectedValue(new Error('network'));

    await useRevisionComparisonStore.getState().compare('workflow-1', 1, 2);

    expect(useRevisionComparisonStore.getState()).toMatchObject({
      comparison: null,
      isLoading: false,
      error: 'These revisions could not be compared.',
    });
    expect(useUIStore.getState().selectedNodeId).toBe('start');
  });
});
