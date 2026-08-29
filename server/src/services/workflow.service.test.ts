import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  startSession: vi.fn(),
  workflowAggregate: vi.fn(),
  workflowCreate: vi.fn(),
  workflowFind: vi.fn(),
  workflowFindById: vi.fn(),
  workflowFindOne: vi.fn(),
  workflowUpdateOne: vi.fn(),
  workflowDeleteOne: vi.fn(),
  revisionCreate: vi.fn(),
  revisionFindOne: vi.fn(),
  revisionDeleteMany: vi.fn(),
  executionDeleteMany: vi.fn(),
}));

vi.mock('mongoose', () => ({ default: { startSession: mocks.startSession } }));
vi.mock('../models/Workflow.model', () => ({
  Workflow: {
    aggregate: mocks.workflowAggregate,
    create: mocks.workflowCreate,
    find: mocks.workflowFind,
    findById: mocks.workflowFindById,
    findOne: mocks.workflowFindOne,
    updateOne: mocks.workflowUpdateOne,
    deleteOne: mocks.workflowDeleteOne,
  },
}));
vi.mock('../models/WorkflowRevision.model', () => ({
  WorkflowRevision: {
    collection: { name: 'workflowrevisions' },
    create: mocks.revisionCreate,
    findOne: mocks.revisionFindOne,
    deleteMany: mocks.revisionDeleteMany,
  },
}));
vi.mock('../models/ExecutionRun.model', () => ({
  ExecutionRun: {
    collection: { name: 'executionruns' },
    deleteMany: mocks.executionDeleteMany,
  },
}));

import { AppError } from '../middleware/errorHandler.middleware';
import { calculateDefinitionHash } from './workflowDefinition';
import {
  assertWorkflowRevisionForAiGeneration,
  createAiGeneratedWorkflowRevision,
  createWorkflow,
  deleteWorkflow,
  getWorkflowAiPromptContext,
  getWorkflowById,
  listWorkflows,
  migrateWorkflowRevisions,
  updateWorkflow,
} from './workflow.service';

function objectId(value: string) {
  return { toString: () => value };
}

function queryResult<T>(value: T) {
  const promise = Promise.resolve(value);
  const query = {
    session: vi.fn(),
    sort: vi.fn(),
    limit: vi.fn(),
    select: vi.fn(),
    lean: vi.fn(),
    then: promise.then.bind(promise),
  };
  query.session.mockReturnValue(query);
  query.sort.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  query.select.mockReturnValue(query);
  query.lean.mockReturnValue(promise);
  return query;
}

const nodesV1 = [
  { id: 'start', type: 'start' as const, label: 'Start', position: { x: 0, y: 0 }, config: {} },
  { id: 'api', type: 'api_call' as const, label: 'API', position: { x: 200, y: 0 }, config: { url: 'https://v1.example.test', method: 'GET' as const, headers: {} } },
];
const edges = [{ id: 'start-api', source: 'start', target: 'api' }];

function makeRoot(revision = 1) {
  return {
    _id: objectId('workflow-1'),
    userId: 'user-1',
    name: 'Workflow',
    description: undefined,
    isGeneratedByAI: false,
    currentRevisionId: objectId(`revision-${revision}`),
    currentRevision: revision,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    save: vi.fn().mockResolvedValue(undefined),
  };
}

function makeRevision(
  revision = 1,
  nodes = nodesV1,
  generationMetadata?: { originalPrompt: string; generatedAt: Date; provider?: string; model?: string },
) {
  return {
    _id: objectId(`revision-${revision}`),
    workflowId: objectId('workflow-1'),
    userId: 'user-1',
    revision,
    parentRevisionId: revision === 1 ? null : objectId(`revision-${revision - 1}`),
    source: 'manual',
    nodes,
    edges,
    generationMetadata,
    definitionHash: calculateDefinitionHash({ nodes, edges, ...(generationMetadata ? { generationMetadata } : {}) }),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

beforeEach(() => {
  const session = {
    withTransaction: vi.fn(async (operation: () => Promise<unknown>) => operation()),
    endSession: vi.fn().mockResolvedValue(undefined),
  };
  mocks.startSession.mockResolvedValue(session);
  mocks.workflowUpdateOne.mockResolvedValue({ matchedCount: 1 });
  mocks.workflowDeleteOne.mockReturnValue(queryResult({ deletedCount: 1 }));
  mocks.revisionDeleteMany.mockReturnValue(queryResult({ deletedCount: 1 }));
  mocks.executionDeleteMany.mockReturnValue(queryResult({ deletedCount: 1 }));
  mocks.revisionCreate.mockImplementation(async (documents: Array<Record<string, unknown>>) => [{
    ...documents[0],
    _id: objectId(`revision-${String(documents[0].revision)}`),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  }]);
});

describe('immutable workflow revisions', () => {
  it('creates revision 1 and advances the workflow pointer in one transaction', async () => {
    const root = makeRoot();
    root.currentRevision = undefined as unknown as number;
    root.currentRevisionId = undefined as unknown as ReturnType<typeof objectId>;
    mocks.workflowCreate.mockResolvedValue([root]);

    const result = await createWorkflow('user-1', {
      name: 'Workflow',
      nodes: nodesV1,
      edges,
      isGeneratedByAI: false,
    });

    expect(mocks.revisionCreate).toHaveBeenCalledWith([expect.objectContaining({
      workflowId: root._id,
      revision: 1,
      parentRevisionId: null,
      source: 'manual',
      definitionHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    })], expect.objectContaining({ session: expect.any(Object) }));
    expect(root.currentRevision).toBe(1);
    expect(root.currentRevisionId?.toString()).toBe('revision-1');
    expect(root.save).toHaveBeenCalled();
    expect(result).toMatchObject({ currentRevision: 1, currentRevisionId: 'revision-1' });
  });

  it('creates v2 for a valid definition change and leaves v1 unchanged', async () => {
    const root = makeRoot(1);
    const updatedRoot = makeRoot(2);
    const revisionV1 = makeRevision(1);
    const originalV1 = structuredClone({ nodes: revisionV1.nodes, definitionHash: revisionV1.definitionHash });
    mocks.workflowFindOne
      .mockReturnValueOnce(queryResult(root))
      .mockReturnValueOnce(queryResult(updatedRoot));
    mocks.revisionFindOne.mockReturnValue(queryResult(revisionV1));
    const nodesV2 = nodesV1.map((node) => node.id === 'api'
      ? { ...node, config: { ...node.config, url: 'https://v2.example.test' } }
      : node);

    const result = await updateWorkflow('workflow-1', 'user-1', {
      expectedRevision: 1,
      nodes: nodesV2,
      edges,
    });

    expect(mocks.revisionCreate).toHaveBeenCalledWith([expect.objectContaining({
      revision: 2,
      parentRevisionId: revisionV1._id,
      source: 'manual',
      nodes: nodesV2,
    })], expect.any(Object));
    expect(mocks.workflowUpdateOne).toHaveBeenCalledWith(
      expect.objectContaining({ currentRevision: 1 }),
      { $set: expect.objectContaining({ currentRevision: 2 }) },
      expect.any(Object),
    );
    expect(result.currentRevision).toBe(2);
    expect({ nodes: revisionV1.nodes, definitionHash: revisionV1.definitionHash }).toEqual(originalV1);
  });

  it('does not create a revision or move the pointer for an invalid candidate', async () => {
    const root = makeRoot(1);
    const revisionV1 = makeRevision(1);
    mocks.workflowFindOne.mockReturnValue(queryResult(root));
    mocks.revisionFindOne.mockReturnValue(queryResult(revisionV1));

    await expect(updateWorkflow('workflow-1', 'user-1', {
      expectedRevision: 1,
      nodes: [nodesV1[0], { ...nodesV1[0] }],
      edges: [],
    })).rejects.toMatchObject({ code: 'DUPLICATE_NODE_IDS' });

    expect(mocks.revisionCreate).not.toHaveBeenCalled();
    expect(mocks.workflowUpdateOne).not.toHaveBeenCalled();
    expect(root.currentRevision).toBe(1);
  });

  it('deduplicates an identical save while still compare-and-setting the expected revision', async () => {
    const root = makeRoot(1);
    const revisionV1 = makeRevision(1);
    mocks.workflowFindOne
      .mockReturnValueOnce(queryResult(root))
      .mockReturnValueOnce(queryResult(root));
    mocks.revisionFindOne.mockReturnValue(queryResult(revisionV1));

    const result = await updateWorkflow('workflow-1', 'user-1', {
      expectedRevision: 1,
      nodes: [...nodesV1].reverse(),
      edges,
    });

    expect(mocks.revisionCreate).not.toHaveBeenCalled();
    expect(mocks.workflowUpdateOne).toHaveBeenCalledWith(
      expect.objectContaining({ currentRevision: 1 }),
      { $set: { currentRevision: 1 } },
      expect.any(Object),
    );
    expect(result.currentRevision).toBe(1);
  });

  it('returns a deterministic 409 conflict for a stale save', async () => {
    mocks.workflowFindOne.mockReturnValue(queryResult(makeRoot(2)));

    const error = await updateWorkflow('workflow-1', 'user-1', {
      expectedRevision: 1,
      name: 'Stale name',
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ statusCode: 409, code: 'WORKFLOW_REVISION_CONFLICT' });
    expect(mocks.revisionFindOne).not.toHaveBeenCalled();
    expect(mocks.revisionCreate).not.toHaveBeenCalled();
  });

  it('does not treat carried or manually edited metadata as an AI-generation event', async () => {
    const oldMetadata = { originalPrompt: 'Old prompt', generatedAt: new Date('2026-01-01T00:00:00.000Z') };
    const newMetadata = { originalPrompt: 'New prompt', generatedAt: '2026-01-02T00:00:00.000Z', provider: 'anthropic', model: 'claude' };
    mocks.workflowFindOne
      .mockReturnValueOnce(queryResult(makeRoot(1)))
      .mockReturnValueOnce(queryResult({ ...makeRoot(2), isGeneratedByAI: true }));
    mocks.revisionFindOne.mockReturnValue(queryResult(makeRevision(1, nodesV1, oldMetadata)));

    await updateWorkflow('workflow-1', 'user-1', {
      expectedRevision: 1,
      nodes: nodesV1,
      edges,
      generationMetadata: newMetadata,
    });

    expect(mocks.revisionCreate).toHaveBeenCalledWith([expect.objectContaining({
      revision: 2,
      source: 'manual',
      generationMetadata: newMetadata,
    })], expect.any(Object));
  });

  it('rejects a hash-corrupt current revision on both current reads and writes', async () => {
    const corrupt = { ...makeRevision(1), definitionHash: '0'.repeat(64) };
    mocks.workflowFindOne.mockReturnValue(queryResult(makeRoot(1)));
    mocks.revisionFindOne.mockReturnValue(queryResult(corrupt));

    await expect(getWorkflowById('workflow-1', 'user-1')).rejects.toMatchObject({
      statusCode: 422,
      code: 'WORKFLOW_REVISION_INTEGRITY_ERROR',
    });
    await expect(updateWorkflow('workflow-1', 'user-1', {
      expectedRevision: 1,
      name: 'Must not advance corrupt history',
    })).rejects.toMatchObject({ code: 'WORKFLOW_REVISION_INTEGRITY_ERROR' });
    expect(mocks.revisionCreate).not.toHaveBeenCalled();
    expect(mocks.workflowUpdateOne).not.toHaveBeenCalled();
  });

  it('does not persist an AI candidate that fails the shared graph validation pipeline', async () => {
    mocks.workflowFindOne.mockReturnValue(queryResult(makeRoot(1)));
    mocks.revisionFindOne.mockReturnValue(queryResult(makeRevision(1)));

    await expect(updateWorkflow('workflow-1', 'user-1', {
      expectedRevision: 1,
      nodes: [{ ...nodesV1[1], config: { url: '', method: 'GET', headers: {} } }],
      edges: [],
      generationMetadata: { originalPrompt: 'Invalid AI candidate', generatedAt: '2026-01-02T00:00:00.000Z' },
    })).rejects.toMatchObject({ code: 'INVALID_NODE_CONFIG' });

    expect(mocks.revisionCreate).not.toHaveBeenCalled();
    expect(mocks.workflowUpdateOne).not.toHaveBeenCalled();
  });

  it('creates an explicit AI provenance revision even when the generated graph is unchanged', async () => {
    const currentMetadata = { originalPrompt: 'Prompt P1', generatedAt: new Date('2026-01-01T00:00:00.000Z') };
    const generatedMetadata = {
      originalPrompt: 'Prompt P2',
      generatedAt: '2026-01-02T00:00:00.000Z',
      provider: 'anthropic',
      model: 'claude',
      capabilityCoverage: {
        requestedCapabilities: ['api_call' as const], implementedCapabilities: ['api_call' as const],
        missingCapabilities: [], unsupportedCapabilities: [], coverage: 1, isComplete: true,
      },
    };
    const current = { ...makeRevision(1, nodesV1, currentMetadata), source: 'ai_generated' as const };
    mocks.workflowFindOne
      .mockReturnValueOnce(queryResult(makeRoot(1)))
      .mockReturnValueOnce(queryResult({ ...makeRoot(2), name: 'Generated workflow', isGeneratedByAI: true }));
    mocks.revisionFindOne.mockReturnValue(queryResult(current));

    const result = await createAiGeneratedWorkflowRevision('workflow-1', 'user-1', 1, {
      name: 'Generated workflow',
      nodes: nodesV1,
      edges,
      generationMetadata: generatedMetadata,
    });

    expect(mocks.revisionCreate).toHaveBeenCalledWith([expect.objectContaining({
      revision: 2,
      parentRevisionId: current._id,
      source: 'ai_generated',
      nodes: nodesV1,
      generationMetadata: generatedMetadata,
    })], expect.any(Object));
    expect(mocks.workflowUpdateOne).toHaveBeenCalledWith(
      expect.objectContaining({ currentRevision: 1, currentRevisionId: current._id }),
      { $set: expect.objectContaining({ currentRevision: 2, isGeneratedByAI: true }) },
      expect.any(Object),
    );
    expect(result).toMatchObject({ currentRevision: 2, name: 'Generated workflow', nodes: nodesV1 });
  });

  it('keeps explicit AI persistence tied to its starting revision', async () => {
    mocks.workflowFindOne.mockReturnValue(queryResult(makeRoot(2)));

    await expect(assertWorkflowRevisionForAiGeneration('workflow-1', 'user-1', 1))
      .rejects.toMatchObject({ statusCode: 409, code: 'WORKFLOW_REVISION_CONFLICT' });

    expect(mocks.revisionFindOne).not.toHaveBeenCalled();
    expect(mocks.revisionCreate).not.toHaveBeenCalled();
  });

  it('resolves prompt context only after owner-scoped workflow access', async () => {
    mocks.workflowFindOne.mockReturnValue(queryResult(null));

    await expect(getWorkflowAiPromptContext('workflow-1', 'user-2'))
      .rejects.toMatchObject({ statusCode: 404, code: 'WORKFLOW_NOT_FOUND' });

    expect(mocks.revisionFindOne).not.toHaveBeenCalled();
  });

  it('returns prompt context from the owner-scoped current revision', async () => {
    const root = makeRoot(4);
    const current = {
      ...makeRevision(4, nodesV1, {
        originalPrompt: 'Exact saved prompt',
        generatedAt: new Date('2026-01-04T00:00:00.000Z'),
        provider: 'anthropic',
        model: 'claude',
      }),
      source: 'ai_generated' as const,
    };
    mocks.workflowFindOne.mockReturnValue(queryResult(root));
    mocks.revisionFindOne.mockReturnValue(queryResult(current));

    await expect(getWorkflowAiPromptContext('workflow-1', 'user-1')).resolves.toEqual({
      status: 'available',
      prompt: 'Exact saved prompt',
      promptRevision: 4,
      currentRevision: 4,
      relationship: 'direct',
      provider: 'anthropic',
      model: 'claude',
    });
    expect(mocks.workflowFindOne).toHaveBeenCalledWith({ _id: 'workflow-1', userId: 'user-1' });
    expect(mocks.revisionFindOne).toHaveBeenCalledWith(expect.objectContaining({
      workflowId: root._id,
      userId: 'user-1',
      revision: 4,
    }));
  });

  it('does not leak prompt lineage through a hash-corrupt ancestor', async () => {
    const current = makeRevision(2);
    const corruptAiAncestor = {
      ...makeRevision(1, nodesV1, {
        originalPrompt: 'Must never be returned',
        generatedAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
      source: 'ai_generated' as const,
      definitionHash: '0'.repeat(64),
    };
    mocks.workflowFindOne.mockReturnValue(queryResult(makeRoot(2)));
    mocks.revisionFindOne
      .mockReturnValueOnce(queryResult(current))
      .mockReturnValueOnce(queryResult(corruptAiAncestor));

    await expect(getWorkflowAiPromptContext('workflow-1', 'user-1')).rejects.toMatchObject({
      code: 'WORKFLOW_REVISION_INTEGRITY_ERROR',
    });
  });
});

describe('revision lifecycle and migration', () => {
  it('hydrates dashboard summaries from current revisions and retains latest-run status lookup', async () => {
    mocks.workflowAggregate.mockResolvedValue([]);
    await listWorkflows('user-1');

    const pipeline = mocks.workflowAggregate.mock.calls[0][0];
    expect(pipeline[0]).toEqual({ $match: { userId: 'user-1' } });
    expect(pipeline[2].$lookup.from).toBe('workflowrevisions');
    expect(pipeline[2].$lookup.pipeline[0].$match.$expr.$and).toEqual(expect.arrayContaining([
      { $eq: ['$workflowId', '$$workflowId'] },
      { $eq: ['$userId', '$$workflowUserId'] },
      { $eq: ['$revision', '$$revisionNumber'] },
    ]));
    expect(pipeline[4].$project.nodeCount).toEqual({
      $size: { $ifNull: ['$currentRevisionDocument.nodes', { $ifNull: ['$nodes', []] }] },
    });
    expect(pipeline[5].$lookup.from).toBe('executionruns');
  });

  it('hard-deletes owned revisions and runs with the workflow in one transaction', async () => {
    mocks.workflowFindOne.mockReturnValue(queryResult(makeRoot(1)));
    await deleteWorkflow('workflow-1', 'user-1');

    expect(mocks.executionDeleteMany).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1' }));
    expect(mocks.revisionDeleteMany).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1' }));
    expect(mocks.workflowDeleteOne).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1' }));
  });

  it('migrates a legacy workflow to revision 1 and reruns without creating a duplicate', async () => {
    const legacy = {
      ...makeRoot(1),
      currentRevisionId: undefined,
      currentRevision: undefined,
      nodes: nodesV1,
      edges,
      generationMetadata: undefined,
    };
    mocks.workflowFind
      .mockReturnValueOnce(queryResult([legacy]))
      .mockReturnValueOnce(queryResult([]));
    mocks.workflowFindById.mockReturnValue(queryResult(legacy));
    mocks.revisionFindOne.mockReturnValue(queryResult(null));

    const options = { transactionCapabilityCheck: vi.fn().mockResolvedValue(undefined) };
    const first = await migrateWorkflowRevisions(undefined, options);
    const second = await migrateWorkflowRevisions(undefined, options);

    expect(first).toMatchObject({ scanned: 1, migrated: 1, skipped: 0, failed: 0 });
    expect(second).toMatchObject({ scanned: 0, migrated: 0, skipped: 0, failed: 0 });
    expect(mocks.revisionCreate).toHaveBeenCalledTimes(1);
    expect(mocks.revisionCreate).toHaveBeenCalledWith([expect.objectContaining({ revision: 1, parentRevisionId: null })], expect.any(Object));
    expect(mocks.workflowUpdateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: legacy._id }),
      { $set: expect.objectContaining({ currentRevision: 1 }) },
      expect.any(Object),
    );
  });

  it('performs no writes when there are no workflow roots to inspect', async () => {
    mocks.workflowFind.mockReturnValue(queryResult([]));
    const result = await migrateWorkflowRevisions(undefined, {
      transactionCapabilityCheck: vi.fn().mockResolvedValue(undefined),
    });
    expect(result.scanned).toBe(0);
    expect(mocks.revisionCreate).not.toHaveBeenCalled();
    expect(mocks.workflowUpdateOne).not.toHaveBeenCalled();
  });

  it('dry-runs valid legacy data with zero writes and ignores stray metadata on manual roots', async () => {
    const legacy = {
      ...makeRoot(1),
      currentRevisionId: undefined,
      currentRevision: undefined,
      nodes: nodesV1,
      edges,
      isGeneratedByAI: false,
      generationMetadata: { originalPrompt: 'stray secret prompt', generatedAt: new Date() },
    };
    mocks.workflowFind.mockReturnValue(queryResult([legacy]));
    mocks.revisionFindOne.mockReturnValue(queryResult(null));

    const result = await migrateWorkflowRevisions(undefined, { dryRun: true });

    expect(result).toMatchObject({ scanned: 1, wouldMigrate: 1, migrated: 0, failed: 0 });
    expect(mocks.startSession).not.toHaveBeenCalled();
    expect(mocks.revisionCreate).not.toHaveBeenCalled();
    expect(mocks.workflowUpdateOne).not.toHaveBeenCalled();
    expect(mocks.executionDeleteMany).not.toHaveBeenCalled();
  });

  it('does not persist stray AI metadata when migrating a manual legacy root', async () => {
    const legacy = {
      ...makeRoot(1),
      currentRevisionId: undefined,
      currentRevision: undefined,
      nodes: nodesV1,
      edges,
      isGeneratedByAI: false,
      generationMetadata: { originalPrompt: 'must not become AI provenance', generatedAt: new Date() },
    };
    mocks.workflowFind.mockReturnValue(queryResult([legacy]));
    mocks.workflowFindById.mockReturnValue(queryResult(legacy));
    mocks.revisionFindOne.mockReturnValue(queryResult(null));

    const result = await migrateWorkflowRevisions(undefined, {
      transactionCapabilityCheck: vi.fn().mockResolvedValue(undefined),
    });

    expect(result.migrated).toBe(1);
    expect(mocks.revisionCreate).toHaveBeenCalledWith([expect.objectContaining({
      source: 'manual',
      generationMetadata: undefined,
    })], expect.any(Object));
  });

  it('classifies malformed and partial legacy roots without mutating either record', async () => {
    const malformed = {
      ...makeRoot(1),
      _id: objectId('malformed'),
      currentRevisionId: undefined,
      currentRevision: undefined,
      nodes: [nodesV1[0], { ...nodesV1[0] }],
      edges: [],
    };
    const partial = {
      ...makeRoot(1),
      _id: objectId('partial'),
      currentRevisionId: undefined,
      currentRevision: 1,
    };
    mocks.workflowFind.mockReturnValue(queryResult([malformed, partial]));
    mocks.revisionFindOne.mockReturnValue(queryResult(null));

    const result = await migrateWorkflowRevisions(undefined, { dryRun: true });

    expect(result).toMatchObject({ scanned: 2, invalid: 1, integrityErrors: 1, wouldMigrate: 0 });
    expect(result.failures.map((failure) => failure.code)).toEqual([
      'INVALID_LEGACY_WORKFLOW',
      'PARTIAL_CURRENT_REVISION_POINTER',
    ]);
    expect(mocks.revisionCreate).not.toHaveBeenCalled();
    expect(mocks.workflowUpdateOne).not.toHaveBeenCalled();
  });

  it('reports an unpointed existing revision as ambiguous corruption instead of guessing a repair', async () => {
    const legacy = {
      ...makeRoot(1),
      currentRevisionId: undefined,
      currentRevision: undefined,
      nodes: nodesV1,
      edges,
    };
    mocks.workflowFind.mockReturnValue(queryResult([legacy]));
    mocks.revisionFindOne.mockReturnValue(queryResult(makeRevision(1)));

    const result = await migrateWorkflowRevisions(undefined, { dryRun: true });

    expect(result).toMatchObject({ scanned: 1, integrityErrors: 1, wouldMigrate: 0 });
    expect(result.failures).toContainEqual({
      workflowId: 'workflow-1',
      code: 'AMBIGUOUS_UNPOINTERED_REVISIONS',
    });
    expect(mocks.revisionCreate).not.toHaveBeenCalled();
    expect(mocks.workflowUpdateOne).not.toHaveBeenCalled();
  });

  it('runs transaction preflight before scanning a write migration', async () => {
    const preflight = vi.fn().mockRejectedValue(new AppError(
      503,
      'MONGODB_TRANSACTIONS_UNSUPPORTED',
      'unsupported',
    ));

    await expect(migrateWorkflowRevisions(undefined, { transactionCapabilityCheck: preflight }))
      .rejects.toMatchObject({ code: 'MONGODB_TRANSACTIONS_UNSUPPORTED' });

    expect(preflight).toHaveBeenCalledTimes(1);
    expect(mocks.workflowFind).not.toHaveBeenCalled();
    expect(mocks.revisionCreate).not.toHaveBeenCalled();
  });

  it('re-reads and rejects a legacy graph that changes after scanning but before transactional migration', async () => {
    const candidate = {
      ...makeRoot(1),
      currentRevisionId: undefined,
      currentRevision: undefined,
      nodes: nodesV1,
      edges,
    };
    const changed = {
      ...candidate,
      nodes: [nodesV1[0], { ...nodesV1[0] }],
      edges: [],
    };
    mocks.workflowFind.mockReturnValue(queryResult([candidate]));
    mocks.revisionFindOne.mockReturnValue(queryResult(null));
    mocks.workflowFindById.mockReturnValue(queryResult(changed));

    const result = await migrateWorkflowRevisions(undefined, {
      transactionCapabilityCheck: vi.fn().mockResolvedValue(undefined),
    });

    expect(result).toMatchObject({ scanned: 1, invalid: 1, migrated: 0 });
    expect(result.failures).toContainEqual({
      workflowId: 'workflow-1',
      code: 'WORKFLOW_MIGRATION_INVALID_LEGACY',
    });
    expect(mocks.revisionCreate).not.toHaveBeenCalled();
    expect(mocks.workflowUpdateOne).not.toHaveBeenCalled();
  });
});
