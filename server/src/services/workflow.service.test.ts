import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  aggregate: vi.fn(),
}));

vi.mock('../models/Workflow.model', () => ({
  Workflow: { aggregate: mocks.aggregate },
}));

vi.mock('../models/ExecutionRun.model', () => ({
  ExecutionRun: { collection: { name: 'executionruns' } },
}));

import { listWorkflows } from './workflow.service';

describe('listWorkflows', () => {
  it('returns compact dashboard summaries with a graph-derived count and latest execution status', async () => {
    mocks.aggregate.mockResolvedValue([]);

    await listWorkflows('user-1');

    const pipeline = mocks.aggregate.mock.calls[0][0];
    expect(pipeline[0]).toEqual({ $match: { userId: 'user-1' } });
    expect(pipeline[2].$project).toMatchObject({
      nodeCount: { $size: { $ifNull: ['$nodes', []] } },
    });
    expect(pipeline[2].$project.nodes).toBeUndefined();
    expect(pipeline[3].$lookup.from).toBe('executionruns');
    expect(pipeline[3].$lookup.as).toBe('latestRun');
    expect(pipeline[3].$lookup.pipeline).toEqual(expect.arrayContaining([
      { $match: { $expr: { $and: expect.any(Array) } } },
      { $sort: { createdAt: -1 } },
      { $limit: 1 },
    ]));
    expect(pipeline[4]).toEqual({
      $set: { lastExecutionStatus: { $ifNull: [{ $arrayElemAt: ['$latestRun.status', 0] }, null] } },
    });
  });
});
