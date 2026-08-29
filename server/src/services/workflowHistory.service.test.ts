import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  startSession: vi.fn(),
  workflowFindOne: vi.fn(),
  workflowUpdateOne: vi.fn(),
  revisionAggregate: vi.fn(),
  revisionFindOne: vi.fn(),
  revisionCreate: vi.fn(),
}));

vi.mock('mongoose', () => ({ default: { startSession: mocks.startSession } }));
vi.mock('../models/Workflow.model', () => ({
  Workflow: {
    findOne: mocks.workflowFindOne,
    updateOne: mocks.workflowUpdateOne,
  },
}));
vi.mock('../models/WorkflowRevision.model', () => ({
  WorkflowRevision: {
    collection: { name: 'workflowrevisions' },
    aggregate: mocks.revisionAggregate,
    findOne: mocks.revisionFindOne,
    create: mocks.revisionCreate,
  },
}));
vi.mock('../models/ExecutionRun.model', () => ({
  ExecutionRun: { collection: { name: 'executionruns' } },
}));

import { AppError } from '../middleware/errorHandler.middleware';
import { calculateDefinitionHash } from './workflowDefinition';
import {
  compareWorkflowRevisions,
  getWorkflowRevision,
  listWorkflowRevisions,
  restoreWorkflowRevision,
} from './workflow.service';

function objectId(value: string) {
  return { toString: () => value };
}

function queryResult<T>(value: T) {
  const promise = Promise.resolve(value);
  const query = {
    session: vi.fn(),
    then: promise.then.bind(promise),
  };
  query.session.mockReturnValue(query);
  return query;
}

const nodesA = [
  { id: 'start', type: 'start' as const, label: 'Start A', position: { x: 0, y: 0 }, config: {} },
  { id: 'end', type: 'end' as const, label: 'End A', position: { x: 200, y: 0 }, config: {} },
];
const nodesB = nodesA.map((node) => ({ ...node, label: node.label.replace('A', 'B') }));
const edges = [{ id: 'start-end', source: 'start', target: 'end' }];

function makeRoot(revision = 3) {
  return {
    _id: objectId('workflow-1'),
    userId: 'user-1',
    name: 'Workflow',
    isGeneratedByAI: false,
    currentRevisionId: objectId(`revision-${revision}`),
    currentRevision: revision,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-03T00:00:00.000Z'),
  };
}

function makeRevision(revision: number, nodes = nodesA) {
  return {
    _id: objectId(`revision-${revision}`),
    workflowId: objectId('workflow-1'),
    userId: 'user-1',
    revision,
    parentRevisionId: revision === 1 ? null : objectId(`revision-${revision - 1}`),
    source: 'manual' as const,
    nodes,
    edges,
    definitionHash: calculateDefinitionHash({ nodes, edges }),
    createdAt: new Date(`2026-01-0${revision}T00:00:00.000Z`),
  };
}

beforeEach(() => {
  const session = {
    withTransaction: vi.fn(async (operation: () => Promise<unknown>) => operation()),
    endSession: vi.fn().mockResolvedValue(undefined),
  };
  mocks.startSession.mockResolvedValue(session);
  mocks.workflowUpdateOne.mockResolvedValue({ matchedCount: 1 });
  mocks.revisionCreate.mockImplementation(async (documents: Array<Record<string, unknown>>) => [{
    ...documents[0],
    _id: objectId(`revision-${String(documents[0].revision)}`),
    createdAt: new Date('2026-01-04T00:00:00.000Z'),
  }]);
});

describe('workflow revision history', () => {
  it('lists only the owned workflow newest-first in a bounded cursor page without graph bodies', async () => {
    mocks.workflowFindOne.mockReturnValue(queryResult(makeRoot()));
    mocks.revisionAggregate.mockResolvedValue([
      { ...makeRevision(3, nodesB), nodeCount: 2, edgeCount: 1 },
      { ...makeRevision(2, nodesB), nodeCount: 2, edgeCount: 1 },
      { ...makeRevision(1), nodeCount: 2, edgeCount: 1 },
    ]);

    const page = await listWorkflowRevisions('workflow-1', 'user-1', { limit: 2 });

    expect(page.revisions.map((item) => item.revision)).toEqual([3, 2]);
    expect(page.nextBeforeRevision).toBe(2);
    expect(page.revisions[0]).not.toHaveProperty('nodes');
    expect(page.revisions[0]).not.toHaveProperty('edges');
    const pipeline = mocks.revisionAggregate.mock.calls[0][0];
    expect(pipeline[0].$match.userId).toBe('user-1');
    expect(pipeline[0].$match.workflowId.toString()).toBe('workflow-1');
    expect(pipeline[1]).toEqual({ $sort: { revision: -1 } });
    expect(pipeline[2]).toEqual({ $limit: 3 });
    expect(pipeline[3].$lookup.from).toBe('workflowrevisions');
    expect(pipeline[4].$project).not.toHaveProperty('nodes');
    expect(pipeline[4].$project).not.toHaveProperty('edges');
  });

  it('uses revision-number cursor pagination and ends when no extra row exists', async () => {
    mocks.workflowFindOne.mockReturnValue(queryResult(makeRoot()));
    mocks.revisionAggregate.mockResolvedValue([
      { ...makeRevision(1), nodeCount: 2, edgeCount: 1 },
    ]);

    const page = await listWorkflowRevisions('workflow-1', 'user-1', {
      limit: 2,
      beforeRevision: 2,
    });

    expect(page.nextBeforeRevision).toBeNull();
    const match = mocks.revisionAggregate.mock.calls[0][0][0].$match;
    expect(match.workflowId.toString()).toBe('workflow-1');
    expect(match.userId).toBe('user-1');
    expect(match.revision).toEqual({ $lt: 2 });
  });

  it('paginates a 250-revision history deterministically when a newer save appears between pages', async () => {
    mocks.workflowFindOne.mockReturnValue(queryResult(makeRoot(250)));
    const rows = Array.from({ length: 250 }, (_, index) => {
      const revision = 250 - index;
      return {
        ...makeRevision(revision),
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        nodeCount: 2,
        edgeCount: 1,
      };
    });
    mocks.revisionAggregate.mockImplementation(async (pipeline: Array<{
      $match?: { revision?: { $lt?: number } };
      $limit?: number;
    }>) => {
      const before = pipeline[0].$match?.revision?.$lt;
      const limit = pipeline[2].$limit ?? 0;
      return rows.filter((row) => before === undefined || row.revision < before).slice(0, limit);
    });

    const first = await listWorkflowRevisions('workflow-1', 'user-1', { limit: 20 });
    rows.unshift({
      ...makeRevision(251),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      nodeCount: 2,
      edgeCount: 1,
    });
    const second = await listWorkflowRevisions('workflow-1', 'user-1', {
      limit: 20,
      beforeRevision: first.nextBeforeRevision!,
    });

    expect(first.revisions.map((item) => item.revision)).toEqual(Array.from({ length: 20 }, (_, index) => 250 - index));
    expect(second.revisions.map((item) => item.revision)).toEqual(Array.from({ length: 20 }, (_, index) => 230 - index));
    expect(new Set([...first.revisions, ...second.revisions].map((item) => item.revision)).size).toBe(40);
    expect(first.revisions[0]).not.toHaveProperty('nodes');
    expect(second.revisions[0]).not.toHaveProperty('edges');
  });

  it('retrieves exact current and historical immutable definitions', async () => {
    mocks.workflowFindOne.mockReturnValue(queryResult(makeRoot()));
    mocks.revisionFindOne
      .mockReturnValueOnce(queryResult(makeRevision(3, nodesB)))
      .mockReturnValueOnce(queryResult(makeRevision(1)));

    const current = await getWorkflowRevision('workflow-1', 'user-1', 3);
    const historical = await getWorkflowRevision('workflow-1', 'user-1', 1);

    expect(current).toMatchObject({ revision: 3, nodes: nodesB, edges });
    expect(historical).toMatchObject({
      workflowId: 'workflow-1',
      revision: 1,
      nodes: nodesA,
      edges,
      definitionHash: calculateDefinitionHash({ nodes: nodesA, edges }),
    });
    const exactRevisionFilter = mocks.revisionFindOne.mock.calls.at(-1)?.[0];
    expect(exactRevisionFilter.workflowId.toString()).toBe('workflow-1');
    expect(exactRevisionFilter).toMatchObject({ userId: 'user-1', revision: 1 });
  });

  it('returns a revision-specific not-found error for a missing owned revision', async () => {
    mocks.workflowFindOne.mockReturnValue(queryResult(makeRoot()));
    mocks.revisionFindOne.mockReturnValue(queryResult(null));

    await expect(getWorkflowRevision('workflow-1', 'user-1', 99)).rejects.toMatchObject({
      statusCode: 404,
      code: 'WORKFLOW_REVISION_NOT_FOUND',
    });
  });

  it('rejects a hash-corrupt exact revision instead of presenting it as historical truth', async () => {
    mocks.workflowFindOne.mockReturnValue(queryResult(makeRoot()));
    mocks.revisionFindOne.mockReturnValue(queryResult({
      ...makeRevision(1),
      definitionHash: 'f'.repeat(64),
    }));

    await expect(getWorkflowRevision('workflow-1', 'user-1', 1)).rejects.toMatchObject({
      statusCode: 422,
      code: 'WORKFLOW_REVISION_INTEGRITY_ERROR',
    });
  });
});

describe('owner-scoped workflow revision comparison', () => {
  it('I/J: reads both revisions in the owned workflow context without any writes', async () => {
    mocks.workflowFindOne.mockReturnValue(queryResult(makeRoot()));
    mocks.revisionFindOne
      .mockReturnValueOnce(queryResult(makeRevision(1)))
      .mockReturnValueOnce(queryResult(makeRevision(2, nodesB)));

    const comparison = await compareWorkflowRevisions('workflow-1', 'user-1', 1, 2);

    expect(comparison.from.revision).toBe(1);
    expect(comparison.to.revision).toBe(2);
    expect(comparison.nodes.modified).toHaveLength(2);
    for (const [filter] of mocks.revisionFindOne.mock.calls) {
      expect(filter.workflowId.toString()).toBe('workflow-1');
      expect(filter.userId).toBe('user-1');
    }
    expect(mocks.revisionCreate).not.toHaveBeenCalled();
    expect(mocks.workflowUpdateOne).not.toHaveBeenCalled();
  });

  it('K: resolves a same-revision comparison once and returns no graph changes', async () => {
    mocks.workflowFindOne.mockReturnValue(queryResult(makeRoot()));
    mocks.revisionFindOne.mockReturnValue(queryResult(makeRevision(2)));

    const comparison = await compareWorkflowRevisions('workflow-1', 'user-1', 2, 2);

    expect(comparison.hasChanges).toBe(false);
    expect(mocks.revisionFindOne).toHaveBeenCalledTimes(1);
  });

  it('L: rejects foreign ownership before reading revisions', async () => {
    mocks.workflowFindOne.mockReturnValue(queryResult(null));

    await expect(compareWorkflowRevisions('workflow-1', 'user-2', 1, 2))
      .rejects.toMatchObject({ statusCode: 404, code: 'WORKFLOW_NOT_FOUND' });

    expect(mocks.revisionFindOne).not.toHaveBeenCalled();
  });

  it('L: cannot mix a missing or foreign target revision into an owned comparison', async () => {
    mocks.workflowFindOne.mockReturnValue(queryResult(makeRoot()));
    mocks.revisionFindOne
      .mockReturnValueOnce(queryResult(makeRevision(1)))
      .mockReturnValueOnce(queryResult(null));

    await expect(compareWorkflowRevisions('workflow-1', 'user-1', 1, 99))
      .rejects.toMatchObject({ statusCode: 404, code: 'WORKFLOW_REVISION_NOT_FOUND' });
  });

  it('rejects comparison when either immutable input fails canonical hash verification', async () => {
    mocks.workflowFindOne.mockReturnValue(queryResult(makeRoot()));
    mocks.revisionFindOne
      .mockReturnValueOnce(queryResult(makeRevision(1)))
      .mockReturnValueOnce(queryResult({ ...makeRevision(2, nodesB), definitionHash: '0'.repeat(64) }));

    await expect(compareWorkflowRevisions('workflow-1', 'user-1', 1, 2)).rejects.toMatchObject({
      statusCode: 422,
      code: 'WORKFLOW_REVISION_INTEGRITY_ERROR',
    });
  });
});

describe('restore as a new immutable revision', () => {
  it('copies v1 into new v4, parents it to v3, records provenance, and never rewinds history', async () => {
    const rootV3 = makeRoot(3);
    const rootV4 = makeRoot(4);
    const currentV3 = makeRevision(3, nodesB);
    const targetV1 = makeRevision(1);
    const originalHistory = {
      currentV3Nodes: structuredClone(currentV3.nodes),
      currentV3Hash: currentV3.definitionHash,
      targetV1Nodes: structuredClone(targetV1.nodes),
      targetV1Hash: targetV1.definitionHash,
    };
    mocks.workflowFindOne
      .mockReturnValueOnce(queryResult(rootV3))
      .mockReturnValueOnce(queryResult(rootV4));
    mocks.revisionFindOne
      .mockReturnValueOnce(queryResult(currentV3))
      .mockReturnValueOnce(queryResult(targetV1));

    const result = await restoreWorkflowRevision('workflow-1', 'user-1', 1, { expectedRevision: 3 });

    const createdV4 = mocks.revisionCreate.mock.calls[0][0][0];
    expect(createdV4).toMatchObject({
      revision: 4,
      source: 'restore',
      nodes: nodesA,
      edges,
      definitionHash: targetV1.definitionHash,
    });
    expect(createdV4.parentRevisionId.toString()).toBe('revision-3');
    expect(createdV4.restoredFromRevisionId.toString()).toBe('revision-1');
    expect(mocks.workflowUpdateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        currentRevision: 3,
        currentRevisionId: currentV3._id,
      }),
      { $set: expect.objectContaining({ currentRevision: 4 }) },
      expect.any(Object),
    );
    expect(result).toMatchObject({ currentRevision: 4, nodes: nodesA, edges });
    expect(currentV3.nodes).toEqual(originalHistory.currentV3Nodes);
    expect(currentV3.definitionHash).toBe(originalHistory.currentV3Hash);
    expect(targetV1.nodes).toEqual(originalHistory.targetV1Nodes);
    expect(targetV1.definitionHash).toBe(originalHistory.targetV1Hash);
  });

  it('creates a semantic restore event even when the historical and current hashes match', async () => {
    mocks.workflowFindOne
      .mockReturnValueOnce(queryResult(makeRoot(3)))
      .mockReturnValueOnce(queryResult(makeRoot(4)));
    mocks.revisionFindOne
      .mockReturnValueOnce(queryResult(makeRevision(3)))
      .mockReturnValueOnce(queryResult(makeRevision(1)));

    await restoreWorkflowRevision('workflow-1', 'user-1', 1, { expectedRevision: 3 });

    const restoreEvent = mocks.revisionCreate.mock.calls[0][0][0];
    expect(restoreEvent).toMatchObject({ revision: 4, source: 'restore' });
    expect(restoreEvent.restoredFromRevisionId.toString()).toBe('revision-1');
  });

  it('rejects restoring the current revision without creating a meaningless event', async () => {
    mocks.workflowFindOne.mockReturnValue(queryResult(makeRoot(3)));

    await expect(restoreWorkflowRevision('workflow-1', 'user-1', 3, { expectedRevision: 3 }))
      .rejects.toMatchObject({ statusCode: 400, code: 'CANNOT_RESTORE_CURRENT_REVISION' });

    expect(mocks.revisionFindOne).not.toHaveBeenCalled();
    expect(mocks.revisionCreate).not.toHaveBeenCalled();
    expect(mocks.workflowUpdateOne).not.toHaveBeenCalled();
  });

  it('rejects a stale restore before reading or writing any revision', async () => {
    mocks.workflowFindOne.mockReturnValue(queryResult(makeRoot(3)));

    const error = await restoreWorkflowRevision('workflow-1', 'user-1', 1, { expectedRevision: 2 })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ statusCode: 409, code: 'WORKFLOW_REVISION_CONFLICT' });
    expect(mocks.revisionFindOne).not.toHaveBeenCalled();
    expect(mocks.revisionCreate).not.toHaveBeenCalled();
    expect(mocks.workflowUpdateOne).not.toHaveBeenCalled();
  });

  it('rejects an invalid or hash-corrupted target before creating a revision or moving the pointer', async () => {
    const corruptTarget = {
      ...makeRevision(1),
      nodes: [
        nodesA[0],
        { ...nodesA[0] },
      ],
    };
    mocks.workflowFindOne.mockReturnValue(queryResult(makeRoot(3)));
    mocks.revisionFindOne
      .mockReturnValueOnce(queryResult(makeRevision(3, nodesB)))
      .mockReturnValueOnce(queryResult(corruptTarget));

    await expect(restoreWorkflowRevision('workflow-1', 'user-1', 1, { expectedRevision: 3 }))
      .rejects.toMatchObject({ statusCode: 422, code: 'WORKFLOW_REVISION_INTEGRITY_ERROR' });

    expect(mocks.revisionCreate).not.toHaveBeenCalled();
    expect(mocks.workflowUpdateOne).not.toHaveBeenCalled();
  });

  it('does not attempt the pointer update when revision creation fails inside the transaction', async () => {
    mocks.workflowFindOne.mockReturnValue(queryResult(makeRoot(3)));
    mocks.revisionFindOne
      .mockReturnValueOnce(queryResult(makeRevision(3, nodesB)))
      .mockReturnValueOnce(queryResult(makeRevision(1)));
    mocks.revisionCreate.mockRejectedValue(new Error('write failed'));

    await expect(restoreWorkflowRevision('workflow-1', 'user-1', 1, { expectedRevision: 3 }))
      .rejects.toThrow('write failed');

    const session = await mocks.startSession.mock.results[0].value;
    expect(session.withTransaction).toHaveBeenCalledTimes(1);
    expect(mocks.workflowUpdateOne).not.toHaveBeenCalled();
  });
});

describe('revision history authorization', () => {
  it('rejects list, get, and restore before revision access when the workflow is not owned', async () => {
    mocks.workflowFindOne.mockReturnValue(queryResult(null));

    await expect(listWorkflowRevisions('workflow-a', 'user-b', { limit: 20 }))
      .rejects.toMatchObject({ statusCode: 404, code: 'WORKFLOW_NOT_FOUND' });
    await expect(getWorkflowRevision('workflow-a', 'user-b', 1))
      .rejects.toMatchObject({ statusCode: 404, code: 'WORKFLOW_NOT_FOUND' });
    await expect(restoreWorkflowRevision('workflow-a', 'user-b', 1, { expectedRevision: 3 }))
      .rejects.toMatchObject({ statusCode: 404, code: 'WORKFLOW_NOT_FOUND' });

    expect(mocks.revisionAggregate).not.toHaveBeenCalled();
    expect(mocks.revisionFindOne).not.toHaveBeenCalled();
    expect(mocks.revisionCreate).not.toHaveBeenCalled();
  });
});
