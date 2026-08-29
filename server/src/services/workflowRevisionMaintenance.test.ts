import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  workflowFind: vi.fn(),
  workflowUpdateOne: vi.fn(),
  revisionFind: vi.fn(),
  revisionCreate: vi.fn(),
  executionUpdateMany: vi.fn(),
}));

vi.mock('../models/Workflow.model', () => ({
  Workflow: { find: mocks.workflowFind, updateOne: mocks.workflowUpdateOne },
}));
vi.mock('../models/WorkflowRevision.model', () => ({
  WorkflowRevision: { find: mocks.revisionFind, create: mocks.revisionCreate },
}));

import { calculateDefinitionHash } from './workflowDefinition';
import { verifyWorkflowRevisions } from './workflowRevisionMaintenance';

function objectId(value: string) {
  return { toString: () => value };
}

function queryResult<T>(value: T) {
  const promise = Promise.resolve(value);
  const query = {
    sort: vi.fn(),
    limit: vi.fn(),
    then: promise.then.bind(promise),
  };
  query.sort.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  return query;
}

const nodes = [
  { id: 'start', type: 'start' as const, label: 'Start', position: { x: 0, y: 0 }, config: {} },
  { id: 'end', type: 'end' as const, label: 'End', position: { x: 100, y: 0 }, config: {} },
];
const edges = [{ id: 'edge', source: 'start', target: 'end' }];

function root(id: string, currentRevisionId?: string, currentRevision?: number) {
  return {
    _id: objectId(id),
    userId: `owner-${id}`,
    currentRevisionId: currentRevisionId ? objectId(currentRevisionId) : undefined,
    currentRevision,
  };
}

function revision(workflowId: string, id: string, definitionHash = calculateDefinitionHash({ nodes, edges })) {
  return {
    _id: objectId(id),
    workflowId: objectId(workflowId),
    userId: `owner-${workflowId}`,
    revision: 1,
    parentRevisionId: null,
    source: 'manual' as const,
    nodes,
    edges,
    definitionHash,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('read-only workflow revision verifier', () => {
  it('uses bounded pages and reports valid, legacy, partial, and hash-corrupt roots without writes', async () => {
    const valid = root('valid', 'valid-r1', 1);
    const corrupt = root('corrupt', 'corrupt-r1', 1);
    const legacy = root('legacy');
    const partial = root('partial', undefined, 1);
    mocks.workflowFind
      .mockReturnValueOnce(queryResult([valid, corrupt]))
      .mockReturnValueOnce(queryResult([legacy, partial]))
      .mockReturnValueOnce(queryResult([]));
    mocks.revisionFind.mockImplementation((filter: { workflowId: { toString(): string } }) => {
      const id = filter.workflowId.toString();
      return queryResult(id === 'valid'
        ? [revision('valid', 'valid-r1')]
        : [revision('corrupt', 'corrupt-r1', '0'.repeat(64))]);
    });

    const summary = await verifyWorkflowRevisions({ batchSize: 2 });

    expect(summary).toMatchObject({ scanned: 4, valid: 1, legacy: 1, integrityErrors: 2 });
    expect(summary.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      'REVISION_DEFINITION_INTEGRITY_ERROR',
      'PARTIAL_CURRENT_REVISION_POINTER',
    ]));
    expect(mocks.workflowFind).toHaveBeenCalledTimes(3);
    expect(mocks.workflowUpdateOne).not.toHaveBeenCalled();
    expect(mocks.revisionCreate).not.toHaveBeenCalled();
    expect(mocks.executionUpdateMany).not.toHaveBeenCalled();
  });

  it('detects impossible restore ancestry without attempting repair', async () => {
    const workflow = root('restore', 'restore-r2', 2);
    mocks.workflowFind.mockReturnValueOnce(queryResult([workflow]));
    mocks.revisionFind.mockReturnValue(queryResult([
      revision('restore', 'restore-r1'),
      {
        ...revision('restore', 'restore-r2'),
        revision: 2,
        parentRevisionId: objectId('restore-r1'),
        source: 'restore' as const,
        restoredFromRevisionId: objectId('missing'),
      },
    ]));

    const summary = await verifyWorkflowRevisions();

    expect(summary.integrityErrors).toBeGreaterThan(0);
    expect(summary.issues).toContainEqual(expect.objectContaining({ code: 'RESTORE_RELATIONSHIP_INVALID', revision: 2 }));
    expect(mocks.workflowUpdateOne).not.toHaveBeenCalled();
  });
});
