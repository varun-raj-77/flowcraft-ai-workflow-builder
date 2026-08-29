import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  workflowFindOne: vi.fn(),
  revisionFindOne: vi.fn(),
  executionFindOne: vi.fn(),
}));

vi.mock('../../models/Workflow.model', () => ({
  Workflow: { findOne: mocks.workflowFindOne, updateOne: vi.fn() },
}));
vi.mock('../../models/WorkflowRevision.model', () => ({
  WorkflowRevision: { findOne: mocks.revisionFindOne },
}));
vi.mock('../../models/ExecutionRun.model', () => ({
  ExecutionRun: { findOne: mocks.executionFindOne, find: vi.fn(), create: vi.fn() },
}));

import { calculateDefinitionHash } from '../workflowDefinition';
import { getExecutionRevisionProvenance } from './executionEngine';

function objectId(value: string) {
  return { toString: () => value };
}

const nodes = [{
  id: 'fetch',
  type: 'api_call' as const,
  label: 'Fetch',
  position: { x: 0, y: 0 },
  config: { url: 'https://example.test', method: 'GET' as const, headers: {} },
}];
const definitionHash = calculateDefinitionHash({ nodes, edges: [] });

function pinnedRun(overrides: Record<string, unknown> = {}) {
  return {
    _id: objectId('run-1'),
    workflowId: objectId('workflow-1'),
    workflowRevisionId: objectId('revision-1'),
    workflowRevision: 1,
    definitionHash,
    userId: 'user-1',
    ...overrides,
  };
}

function revision(overrides: Record<string, unknown> = {}) {
  return {
    _id: objectId('revision-1'),
    workflowId: objectId('workflow-1'),
    userId: 'user-1',
    revision: 1,
    parentRevisionId: null,
    source: 'manual',
    nodes,
    edges: [],
    definitionHash,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

beforeEach(() => {
  mocks.executionFindOne.mockResolvedValue(pinnedRun());
  mocks.workflowFindOne.mockResolvedValue({
    _id: objectId('workflow-1'),
    userId: 'user-1',
    currentRevision: 2,
    currentRevisionId: objectId('revision-2'),
  });
  mocks.revisionFindOne.mockResolvedValue(revision());
});

describe('execution revision provenance resolution', () => {
  it('N: verifies the run hash against the exact owned immutable revision', async () => {
    const result = await getExecutionRevisionProvenance('run-1', 'user-1');

    expect(result).toMatchObject({
      status: 'pinned',
      workflowRevision: 1,
      definitionHash,
      currentRevision: 2,
      isCurrent: false,
      canView: true,
      canCompare: true,
    });
    expect(mocks.revisionFindOne).toHaveBeenCalledWith({
      _id: expect.anything(),
      workflowId: expect.anything(),
      userId: 'user-1',
      revision: 1,
    });
  });

  it('reports a run-to-revision hash mismatch and exposes no fallback actions', async () => {
    mocks.revisionFindOne.mockResolvedValue(revision({ definitionHash: 'a'.repeat(64) }));

    const result = await getExecutionRevisionProvenance('run-1', 'user-1');

    expect(result).toMatchObject({ status: 'integrity_error', canView: false, canCompare: false });
  });

  it('recomputes revision content integrity instead of trusting matching stored hashes', async () => {
    mocks.revisionFindOne.mockResolvedValue(revision({
      nodes: [{ ...nodes[0], label: 'Tampered after hashing' }],
    }));

    const result = await getExecutionRevisionProvenance('run-1', 'user-1');

    expect(result).toMatchObject({ status: 'integrity_error', canView: false, canCompare: false });
  });

  it('reports a missing pinned revision as unavailable without loading the current graph', async () => {
    mocks.revisionFindOne.mockResolvedValue(null);

    const result = await getExecutionRevisionProvenance('run-1', 'user-1');

    expect(result).toMatchObject({ status: 'unavailable', canView: false, canCompare: false });
  });

  it('labels fully unpinned legacy runs without inferring provenance', async () => {
    mocks.executionFindOne.mockResolvedValue(pinnedRun({
      workflowRevisionId: undefined,
      workflowRevision: undefined,
      definitionHash: undefined,
    }));

    const result = await getExecutionRevisionProvenance('run-1', 'user-1');

    expect(result.status).toBe('legacy');
    expect(mocks.workflowFindOne).not.toHaveBeenCalled();
    expect(mocks.revisionFindOne).not.toHaveBeenCalled();
  });

  it('rejects cross-user run access before any workflow or revision lookup', async () => {
    mocks.executionFindOne.mockResolvedValue(null);

    await expect(getExecutionRevisionProvenance('run-1', 'user-2'))
      .rejects.toMatchObject({ statusCode: 404, code: 'EXECUTION_NOT_FOUND' });

    expect(mocks.workflowFindOne).not.toHaveBeenCalled();
    expect(mocks.revisionFindOne).not.toHaveBeenCalled();
  });
});
