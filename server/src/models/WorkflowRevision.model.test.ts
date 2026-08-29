import { describe, expect, it } from 'vitest';
import { WorkflowRevision } from './WorkflowRevision.model';

describe('WorkflowRevision model', () => {
  it('has a unique workflow-local revision index and history/ownership indexes', () => {
    const indexes = WorkflowRevision.schema.indexes();
    expect(indexes).toEqual(expect.arrayContaining([
      [{ workflowId: 1, revision: 1 }, { unique: true, background: true }],
      [{ workflowId: 1, createdAt: -1 }, { background: true }],
      [{ userId: 1, workflowId: 1, revision: -1 }, { background: true }],
    ]));
  });

  it('rejects ordinary query updates to historical revisions', async () => {
    await expect(WorkflowRevision.updateOne(
      { revision: 1 },
      { $set: { definitionHash: 'b'.repeat(64) } },
    )).rejects.toThrow('Workflow revisions are immutable');
  });

  it('rejects saving an already-persisted revision document', async () => {
    const revision = new WorkflowRevision({
      workflowId: '66a000000000000000000001',
      userId: 'user-1',
      revision: 1,
      parentRevisionId: null,
      source: 'manual',
      nodes: [],
      edges: [],
      definitionHash: 'a'.repeat(64),
    });
    revision.isNew = false;

    await expect(revision.save()).rejects.toThrow('Workflow revisions are immutable');
  });
});
