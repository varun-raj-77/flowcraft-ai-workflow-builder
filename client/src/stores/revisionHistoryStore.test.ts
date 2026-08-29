import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workflow, WorkflowRevisionDetail, WorkflowRevisionSummary } from '@/types';
import { useWorkflowStore } from './workflowStore';
import { useUIStore } from './uiStore';

const mocks = vi.hoisted(() => ({
  listWorkflowRevisions: vi.fn(),
  getWorkflowRevision: vi.fn(),
  restoreWorkflowRevision: vi.fn(),
}));

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/lib/api');
  return {
    ...actual,
    listWorkflowRevisions: mocks.listWorkflowRevisions,
    getWorkflowRevision: mocks.getWorkflowRevision,
    restoreWorkflowRevision: mocks.restoreWorkflowRevision,
  };
});

import { ApiError } from '@/lib/api';
import { useRevisionHistoryStore } from './revisionHistoryStore';

const workflow: Workflow = {
  _id: 'workflow-1',
  userId: 'user-1',
  name: 'Current workflow',
  nodes: [
    { id: 'start', type: 'start', label: 'Current start', position: { x: 0, y: 0 }, config: {} },
    { id: 'end', type: 'end', label: 'Current end', position: { x: 200, y: 0 }, config: {} },
  ],
  edges: [{ id: 'start-end', source: 'start', target: 'end' }],
  isGeneratedByAI: false,
  currentRevision: 3,
  currentRevisionId: 'revision-3',
  definitionHash: '3'.repeat(64),
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-03T00:00:00.000Z',
};

const revisionV1: WorkflowRevisionDetail = {
  id: 'revision-1',
  workflowId: 'workflow-1',
  revision: 1,
  parentRevisionId: null,
  source: 'manual',
  definitionHash: '1'.repeat(64),
  nodes: [{ id: 'start', type: 'start', label: 'Historical start', position: { x: 10, y: 20 }, config: {} }],
  edges: [],
  createdAt: '2026-08-01T00:00:00.000Z',
};

function summary(revision: number): WorkflowRevisionSummary {
  return {
    id: `revision-${revision}`,
    revision,
    parentRevisionId: revision === 1 ? null : `revision-${revision - 1}`,
    source: 'manual',
    definitionHash: String(revision).repeat(64),
    createdAt: `2026-08-0${revision}T00:00:00.000Z`,
    nodeCount: 2,
    edgeCount: 1,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

beforeEach(() => {
  useRevisionHistoryStore.getState().reset();
  useUIStore.getState().selectNode(null);
  useWorkflowStore.getState().setWorkflow(workflow);
  mocks.listWorkflowRevisions.mockReset();
  mocks.getWorkflowRevision.mockReset();
  mocks.restoreWorkflowRevision.mockReset();
});

describe('revision history store isolation', () => {
  it('opens a bounded history page and appends the revision cursor page', async () => {
    mocks.listWorkflowRevisions
      .mockResolvedValueOnce({ revisions: [summary(3), summary(2)], nextBeforeRevision: 2 })
      .mockResolvedValueOnce({ revisions: [summary(1)], nextBeforeRevision: null });

    await useRevisionHistoryStore.getState().openHistory('workflow-1');
    expect(useRevisionHistoryStore.getState()).toMatchObject({
      isPanelOpen: true,
      revisions: [summary(3), summary(2)],
      nextBeforeRevision: 2,
    });

    await useRevisionHistoryStore.getState().loadMore();
    expect(mocks.listWorkflowRevisions).toHaveBeenLastCalledWith('workflow-1', {
      limit: 20,
      beforeRevision: 2,
    });
    expect(useRevisionHistoryStore.getState().revisions.map((item) => item.revision)).toEqual([3, 2, 1]);
  });

  it('ignores an older same-workflow refresh that resolves after a newer request', async () => {
    const first = deferred<{ revisions: WorkflowRevisionSummary[]; nextBeforeRevision: number | null }>();
    const second = deferred<{ revisions: WorkflowRevisionSummary[]; nextBeforeRevision: number | null }>();
    mocks.listWorkflowRevisions
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const olderRequest = useRevisionHistoryStore.getState().refreshHistory('workflow-1');
    const newerRequest = useRevisionHistoryStore.getState().refreshHistory('workflow-1');
    second.resolve({ revisions: [summary(4), summary(3)], nextBeforeRevision: 3 });
    await newerRequest;
    first.resolve({ revisions: [summary(3), summary(2)], nextBeforeRevision: 2 });
    await olderRequest;

    expect(useRevisionHistoryStore.getState().revisions.map((item) => item.revision)).toEqual([4, 3]);
    expect(useRevisionHistoryStore.getState().nextBeforeRevision).toBe(3);
  });

  it('preserves the exact current draft, dirty flag, saved snapshot, undo, and redo through preview and back', async () => {
    useWorkflowStore.getState().updateNodeData('start', { label: 'First unsaved edit' });
    useWorkflowStore.getState().updateNodeData('start', { label: 'Second unsaved edit' });
    useWorkflowStore.getState().undo();
    useUIStore.getState().selectNode('start');
    const before = structuredClone({
      nodes: useWorkflowStore.getState().nodes,
      edges: useWorkflowStore.getState().edges,
      meta: useWorkflowStore.getState().meta,
      isDirty: useWorkflowStore.getState().isDirty,
      savedSnapshot: useWorkflowStore.getState().savedSnapshot,
      undoStack: useWorkflowStore.getState().undoStack,
      redoStack: useWorkflowStore.getState().redoStack,
    });
    mocks.getWorkflowRevision.mockResolvedValue(revisionV1);

    await useRevisionHistoryStore.getState().preview('workflow-1', 1);
    expect(useRevisionHistoryStore.getState().previewRevision).toEqual(revisionV1);
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

    useUIStore.getState().selectNode('historical-only');
    useRevisionHistoryStore.getState().backToCurrent();
    expect(useRevisionHistoryStore.getState().previewRevision).toBeNull();
    expect(useUIStore.getState().selectedNodeId).toBe('start');
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

  it('blocks restore defensively while the current editable draft is dirty', async () => {
    useWorkflowStore.getState().updateNodeData('start', { label: 'Unsaved' });
    useRevisionHistoryStore.setState({ previewRevision: revisionV1 });

    await expect(useRevisionHistoryStore.getState().restorePreview('workflow-1', 3))
      .rejects.toMatchObject({ code: 'UNSAVED_CHANGES' });

    expect(mocks.restoreWorkflowRevision).not.toHaveBeenCalled();
    expect(useRevisionHistoryStore.getState().restoreError).toMatch(/Save or discard/);
  });

  it('returns a successful restore response and exits historical mode', async () => {
    const restored: Workflow = {
      ...workflow,
      nodes: revisionV1.nodes,
      edges: revisionV1.edges,
      currentRevision: 4,
      currentRevisionId: 'revision-4',
      definitionHash: revisionV1.definitionHash,
    };
    useRevisionHistoryStore.setState({ previewRevision: revisionV1, isRestoreDialogOpen: true });
    mocks.restoreWorkflowRevision.mockResolvedValue(restored);

    const result = await useRevisionHistoryStore.getState().restorePreview('workflow-1', 3);

    expect(mocks.restoreWorkflowRevision).toHaveBeenCalledWith('workflow-1', 1, { expectedRevision: 3 });
    expect(result).toEqual(restored);
    expect(useRevisionHistoryStore.getState()).toMatchObject({
      previewRevision: null,
      isRestoreDialogOpen: false,
      isRestoring: false,
    });
  });

  it('keeps preview state and exposes actionable text for a stale restore conflict', async () => {
    useRevisionHistoryStore.setState({ previewRevision: revisionV1, isRestoreDialogOpen: true });
    mocks.restoreWorkflowRevision.mockRejectedValue(new ApiError(
      409,
      'WORKFLOW_REVISION_CONFLICT',
      'Workflow revision conflict',
    ));

    await expect(useRevisionHistoryStore.getState().restorePreview('workflow-1', 3)).rejects.toBeInstanceOf(ApiError);

    expect(useRevisionHistoryStore.getState().previewRevision).toEqual(revisionV1);
    expect(useRevisionHistoryStore.getState().restoreError).toBe(
      'This workflow changed while you were viewing history. Return to the latest revision before restoring.',
    );
  });

  it('rejects a same-tick duplicate restore while the first request is in flight', async () => {
    const pending = deferred<Workflow>();
    useRevisionHistoryStore.setState({ previewRevision: revisionV1, isRestoreDialogOpen: true });
    mocks.restoreWorkflowRevision.mockReturnValue(pending.promise);

    const first = useRevisionHistoryStore.getState().restorePreview('workflow-1', 3);
    await expect(useRevisionHistoryStore.getState().restorePreview('workflow-1', 3)).rejects.toMatchObject({
      code: 'RESTORE_IN_PROGRESS',
    });
    expect(mocks.restoreWorkflowRevision).toHaveBeenCalledTimes(1);

    pending.resolve({ ...workflow, currentRevision: 4, currentRevisionId: 'revision-4' });
    await first;
  });
});
