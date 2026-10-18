import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  workflowFindOne: vi.fn(),
  workflowUpdateOne: vi.fn(),
  revisionFindOne: vi.fn(),
  executionCreate: vi.fn(),
  executionUpdateOne: vi.fn(),
  executionFindOne: vi.fn(),
  executionFind: vi.fn(),
  requestPublicHttp: vi.fn(),
}));

vi.mock('./executors/publicHttpTransport', () => ({ requestPublicHttp: mocks.requestPublicHttp }));
vi.mock('../../models/Workflow.model', () => ({
  Workflow: { findOne: mocks.workflowFindOne, updateOne: mocks.workflowUpdateOne },
}));
vi.mock('../../utils/mongoTransaction', () => ({
  runInTransaction: (operation: (session: object) => Promise<unknown>) => operation({}),
}));
vi.mock('../../models/WorkflowRevision.model', () => ({
  WorkflowRevision: { findOne: mocks.revisionFindOne },
}));
vi.mock('../../models/ExecutionRun.model', () => ({
  ExecutionRun: {
    create: mocks.executionCreate,
    updateOne: mocks.executionUpdateOne,
    findOne: mocks.executionFindOne,
    find: mocks.executionFind,
  },
}));

import { calculateDefinitionHash } from '../workflowDefinition';
import { getExecutionById, retryInterruptedExecution, runExecution, startExecution } from './executionEngine';
import { EXECUTION_INTERRUPTED_MESSAGE } from './executionRecovery';

function objectId(value: string) {
  return { toString: () => value };
}

function queryResult<T>(value: T) {
  const promise = Promise.resolve(value);
  const query = { session: vi.fn(), then: promise.then.bind(promise) };
  query.session.mockReturnValue(query);
  return query;
}

const nodesV1 = [{
  id: 'fetch',
  type: 'api_call' as const,
  label: 'Fetch pinned endpoint',
  position: { x: 0, y: 0 },
  config: { url: 'https://v1.example.test/data', method: 'GET' as const, headers: {} },
}];
const nodesV2 = [{
  ...nodesV1[0],
  config: { ...nodesV1[0].config, url: 'https://v2.example.test/data' },
}];

function makeRevision() {
  return {
    _id: objectId('revision-v1'),
    workflowId: objectId('workflow-1'),
    userId: 'user-1',
    revision: 1,
    parentRevisionId: null,
    source: 'manual',
    nodes: nodesV1,
    edges: [],
    definitionHash: calculateDefinitionHash({ nodes: nodesV1, edges: [] }),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

beforeEach(() => {
  mocks.executionUpdateOne.mockReset();
  mocks.executionUpdateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
  mocks.workflowUpdateOne.mockResolvedValue({ matchedCount: 1 });
  mocks.executionCreate.mockImplementation(async (documents: Array<Record<string, unknown>>) => [{
    ...documents[0],
    _id: objectId('run-1'),
    save: vi.fn().mockResolvedValue(undefined),
    markModified: vi.fn(),
  }]);
});

afterEach(() => vi.unstubAllGlobals());

describe('pinned workflow execution', () => {
  it('pins provenance at start and still executes v1 configuration after the workflow advances to v2', async () => {
    const workflow = {
      _id: objectId('workflow-1'),
      userId: 'user-1',
      currentRevisionId: objectId('revision-v1'),
      currentRevision: 1,
      nodes: nodesV1,
    };
    const revisionV1 = makeRevision();
    mocks.workflowFindOne.mockReturnValue(queryResult(workflow));
    mocks.revisionFindOne.mockReturnValue(queryResult(revisionV1));
    mocks.requestPublicHttp.mockResolvedValue({
      status: 200, data: { revision: 1 }, headers: { 'content-type': 'application/json' },
    });

    const run = await startExecution('workflow-1', 'user-1');
    workflow.currentRevisionId = objectId('revision-v2');
    workflow.currentRevision = 2;
    workflow.nodes = nodesV2;
    await runExecution(run);

    expect(run).toMatchObject({
      workflowRevisionId: revisionV1._id,
      workflowRevision: 1,
      definitionHash: revisionV1.definitionHash,
      status: 'completed',
    });
    expect(mocks.requestPublicHttp).toHaveBeenCalledWith('https://v1.example.test/data', expect.any(Object));
    expect(mocks.requestPublicHttp).not.toHaveBeenCalledWith('https://v2.example.test/data', expect.any(Object));
    expect(run.stepLogs[0].input).toEqual({ config: nodesV1[0].config });
    expect(mocks.workflowFindOne).toHaveBeenCalledTimes(1);
    expect(mocks.revisionFindOne.mock.calls[1][0]).toMatchObject({
      _id: revisionV1._id,
      workflowId: workflow._id,
      userId: 'user-1',
      revision: 1,
      definitionHash: revisionV1.definitionHash,
    });
  });

  it('does not enter a node executor when the initial fencing check loses ownership', async () => {
    const rev = makeRevision();
    mocks.workflowFindOne.mockReturnValue(queryResult({
      _id: objectId('workflow-1'), userId: 'user-1',
      currentRevision: 1, currentRevisionId: rev._id,
    }));
    mocks.revisionFindOne.mockReturnValue(queryResult(rev));
    const run = await startExecution('workflow-1', 'user-1');
    expect(run.leaseOwner).toBeTruthy();
    mocks.executionUpdateOne.mockResolvedValueOnce({ matchedCount: 0 });
    await runExecution(run);
    expect(mocks.requestPublicHttp).not.toHaveBeenCalled();
    expect(run.status).toBe('running'); // Recovery owns the durable final state.
    expect(run.save).not.toHaveBeenCalled();
  });

  it('does not execute further or overwrite recovery when an in-flight API node loses the lease', async () => {
    const rev = makeRevision();
    mocks.workflowFindOne.mockReturnValue(queryResult({
      _id: objectId('workflow-1'), userId: 'user-1',
      currentRevision: 1, currentRevisionId: rev._id,
    }));
    mocks.revisionFindOne.mockReturnValue(queryResult(rev));
    const run = await startExecution('workflow-1', 'user-1');
    mocks.requestPublicHttp.mockImplementationOnce(async () => {
      mocks.executionUpdateOne.mockResolvedValue({ matchedCount: 0 });
      return { status: 200, data: { ok: true }, headers: {} };
    });
    await runExecution(run);
    expect(mocks.requestPublicHttp).toHaveBeenCalledOnce();
    expect(mocks.executionUpdateOne.mock.calls.some(([filter, update]) =>
      filter.status === 'running' && update.$set?.status === 'completed')).toBe(false);
    expect(run.status).toBe('running');
    expect(run.save).not.toHaveBeenCalled();
  });

  it('rejects cross-user workflow execution before any revision can be attached', async () => {
    mocks.workflowFindOne.mockReturnValue(queryResult(null));
    await expect(startExecution('workflow-1', 'user-2')).rejects.toMatchObject({
      statusCode: 404,
      code: 'WORKFLOW_NOT_FOUND',
    });
    expect(mocks.revisionFindOne).not.toHaveBeenCalled();
    expect(mocks.executionCreate).not.toHaveBeenCalled();
  });

  it('does not create a run when the active revision changes during initialization', async () => {
    const revisionV1 = makeRevision();
    mocks.workflowFindOne.mockReturnValue(queryResult({
      _id: objectId('workflow-1'),
      userId: 'user-1',
      currentRevisionId: revisionV1._id,
      currentRevision: 1,
    }));
    mocks.revisionFindOne.mockReturnValue(queryResult(revisionV1));
    mocks.workflowUpdateOne.mockResolvedValue({ matchedCount: 0 });

    await expect(startExecution('workflow-1', 'user-1')).rejects.toMatchObject({
      statusCode: 409,
      code: 'WORKFLOW_REVISION_CONFLICT',
    });
    expect(mocks.executionCreate).not.toHaveBeenCalled();
  });

  it('reads a legacy unpinned run without fabricating revision provenance', async () => {
    const legacyRun = {
      _id: objectId('legacy-run'),
      workflowId: objectId('workflow-1'),
      userId: 'user-1',
      status: 'completed',
      executionOrder: ['fetch'],
      stepLogs: [],
    };
    mocks.executionFindOne.mockResolvedValue(legacyRun);

    const result = await getExecutionById('legacy-run', 'user-1');

    expect(result).toBe(legacyRun);
    expect(result).not.toHaveProperty('workflowRevisionId');
    expect(result).not.toHaveProperty('workflowRevision');
    expect(result).not.toHaveProperty('definitionHash');
  });

  it('fails legacy unpinned processing truthfully without consulting mutable workflow data', async () => {
    const legacyRun = {
      _id: objectId('legacy-run'),
      workflowId: objectId('workflow-1'),
      userId: 'user-1',
      status: 'running',
      executionOrder: ['fetch'],
      stepLogs: [],
      save: vi.fn().mockResolvedValue(undefined),
      markModified: vi.fn(),
    };

    const result = await runExecution(legacyRun as never);

    expect(result).toBe(legacyRun);
    expect(legacyRun).toMatchObject({
      status: 'failed',
      error: 'Execution run has no pinned workflow revision',
    });
    expect(mocks.workflowFindOne).not.toHaveBeenCalled();
    expect(mocks.revisionFindOne).not.toHaveBeenCalled();
  });
});


describe('M10 explicitly acknowledged, idempotent interrupted-execution retries', () => {
  const sourceRunId = '507f1f77bcf86cd799439011';
  const sourceRevision = makeRevision();

  function source(overrides: Record<string, unknown> = {}) {
    return {
      _id: objectId(sourceRunId),
      workflowId: objectId('workflow-1'),
      userId: 'user-1',
      status: 'failed',
      error: EXECUTION_INTERRUPTED_MESSAGE,
      workflowRevisionId: sourceRevision._id,
      workflowRevision: 1,
      definitionHash: sourceRevision.definitionHash,
      ...overrides,
    };
  }

  function setup(overrides: Record<string, unknown> = {}) {
    const interrupted = source(overrides);
    mocks.workflowFindOne.mockReturnValue(queryResult({
      _id: objectId('workflow-1'), userId: 'user-1',
      currentRevisionId: sourceRevision._id,
      currentRevision: 1,
    }));
    mocks.revisionFindOne.mockReturnValue(queryResult(sourceRevision));
    mocks.executionFindOne.mockImplementation((filter: { retryOfRunId?: string }) =>
      queryResult(filter.retryOfRunId ? null : interrupted));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.workflowUpdateOne.mockResolvedValue({ matchedCount: 1 });
    mocks.executionUpdateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    mocks.executionCreate.mockImplementation(async (documents: Array<Record<string, unknown>>) => [{
      ...documents[0], _id: objectId('new-run-1'),
      save: vi.fn(), markModified: vi.fn(),
    }]);
    setup();
  });

  it('requires explicit confirmation before reading data or creating side effects', async () => {
    await expect(retryInterruptedExecution(sourceRunId, 'user-1', false))
      .rejects.toMatchObject({ code: 'RETRY_ACKNOWLEDGEMENT_REQUIRED', statusCode: 400 });
    expect(mocks.executionFindOne).not.toHaveBeenCalled();
    expect(mocks.executionCreate).not.toHaveBeenCalled();
  });

  it('validates source ID format before database operations', async () => {
    await expect(retryInterruptedExecution('invalid', 'user-1', true))
      .rejects.toMatchObject({ code: 'INVALID_ID', statusCode: 400 });
    expect(mocks.executionFindOne).not.toHaveBeenCalled();
  });

  it('rejects missing/cross-tenant sources without revealing their existence', async () => {
    mocks.executionFindOne.mockReturnValue(queryResult(null));
    await expect(retryInterruptedExecution(sourceRunId, 'attacker-2', true))
      .rejects.toMatchObject({ code: 'EXECUTION_NOT_FOUND', statusCode: 404 });
    expect(mocks.executionCreate).not.toHaveBeenCalled();
  });

  it('refuses ordinary errors, ongoing runs and completed runs', async () => {
    for (const overrides of [
      { status: 'running' }, { status: 'completed' }, { status: 'failed', error: 'API 500' },
    ]) {
      setup(overrides);
      await expect(retryInterruptedExecution(sourceRunId, 'user-1', true))
        .rejects.toMatchObject({ code: 'RETRY_SOURCE_NOT_INTERRUPTED', statusCode: 409 });
    }
    expect(mocks.executionCreate).not.toHaveBeenCalled();
  });

  it('rechecks revision identity inside the creation transaction and rejects v2 drift', async () => {
    setup();
    mocks.workflowFindOne.mockReturnValue(queryResult({
      _id: objectId('workflow-1'), userId: 'user-1',
      currentRevisionId: objectId('revision-v2'), currentRevision: 2,
    }));
    await expect(retryInterruptedExecution(sourceRunId, 'user-1', true))
      .rejects.toMatchObject({ code: 'RETRY_REVISION_CHANGED', statusCode: 409 });
    expect(mocks.executionCreate).not.toHaveBeenCalled();
  });

  it('rejects stored source hash mismatch with the still-current immutable revision', async () => {
    setup({ definitionHash: 'a'.repeat(64) });
    await expect(retryInterruptedExecution(sourceRunId, 'user-1', true))
      .rejects.toMatchObject({ code: 'RETRY_REVISION_CHANGED', statusCode: 409 });
    expect(mocks.executionCreate).not.toHaveBeenCalled();
  });

  it('creates a fresh, pinned run with new step logs, retry lineage and a separate lease', async () => {
    const result = await retryInterruptedExecution(sourceRunId, 'user-1', true);
    expect(result.created).toBe(true);
    expect(result.run).toMatchObject({
      status: 'running',
      retryOfRunId: expect.anything(),
      workflowRevision: 1,
      definitionHash: sourceRevision.definitionHash,
    });
    expect(result.run.retryOfRunId?.toString()).toBe(sourceRunId);
    expect(result.run.leaseOwner).toBeTruthy();
    expect(mocks.executionCreate).toHaveBeenCalledOnce();
    expect(mocks.executionCreate.mock.calls[0][0][0]).toMatchObject({
      retryOfRunId: expect.anything(),
      status: 'running',
      stepLogs: [{ status: 'pending' }],
    });
  });

  it('returns an existing attempt without creating or executing another run', async () => {
    const prior = { _id: objectId('previous'), retryOfRunId: objectId(sourceRunId), status: 'completed' };
    mocks.executionFindOne.mockImplementation((filter: { retryOfRunId?: string }) =>
      queryResult(filter.retryOfRunId ? prior : source()));
    const result = await retryInterruptedExecution(sourceRunId, 'user-1', true);
    expect(result).toEqual({ run: prior, created: false });
    expect(mocks.executionCreate).not.toHaveBeenCalled();
  });

  it('resolves concurrent unique-index races by returning the winning run only', async () => {
    const prior = { _id: objectId('winner'), retryOfRunId: objectId(sourceRunId), status: 'running' };
    let checks = 0;
    mocks.executionFindOne.mockImplementation((filter: { retryOfRunId?: string }) => {
      if (!filter.retryOfRunId) return queryResult(source());
      checks += 1;
      return queryResult(checks > 1 ? prior : null);
    });
    mocks.executionCreate.mockRejectedValueOnce(Object.assign(new Error('duplicate'), {
      code: 11000, keyPattern: { retryOfRunId: 1 },
    }));
    const result = await retryInterruptedExecution(sourceRunId, 'user-1', true);
    expect(result).toEqual({ run: prior, created: false });
    expect(mocks.executionCreate).toHaveBeenCalledOnce();
  });

  it('does not misclassify unrelated unique constraint violations as successful retries', async () => {
    mocks.executionCreate.mockRejectedValueOnce(Object.assign(new Error('duplicate elsewhere'), {
      code: 11000, keyPattern: { unrelated: 1 },
    }));
    await expect(retryInterruptedExecution(sourceRunId, 'user-1', true))
      .rejects.toThrow('duplicate elsewhere');
  });
});
