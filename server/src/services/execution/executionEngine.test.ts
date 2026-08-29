import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  workflowFindOne: vi.fn(),
  workflowUpdateOne: vi.fn(),
  revisionFindOne: vi.fn(),
  executionCreate: vi.fn(),
  executionFindOne: vi.fn(),
  executionFind: vi.fn(),
}));

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
    findOne: mocks.executionFindOne,
    find: mocks.executionFind,
  },
}));

import { calculateDefinitionHash } from '../workflowDefinition';
import { getExecutionById, runExecution, startExecution } from './executionEngine';

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
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ revision: 1 }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

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
    expect(fetchMock).toHaveBeenCalledWith('https://v1.example.test/data', expect.any(Object));
    expect(fetchMock).not.toHaveBeenCalledWith('https://v2.example.test/data', expect.any(Object));
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
