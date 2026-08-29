import { beforeEach, describe, expect, it, vi } from 'vitest';

interface StoredRoot extends Record<string, unknown> {
  _id: { toString(): string };
  userId: string;
  currentRevisionId?: { toString(): string };
  currentRevision?: number;
}

interface StoredRevision extends Record<string, unknown> {
  _id: { toString(): string };
  workflowId: { toString(): string };
  userId: string;
  revision: number;
}

const state = vi.hoisted(() => ({
  root: null as StoredRoot | null,
  revisions: [] as StoredRevision[],
  runs: [] as Array<Record<string, unknown>>,
  transactionTail: Promise.resolve() as Promise<void>,
  failPointerUpdate: false,
  failRevisionDelete: false,
}));

function id(value: string) {
  return { toString: () => value };
}

function lazyQuery<T>(read: () => T | Promise<T>) {
  const query = {
    session: vi.fn(),
    sort: vi.fn(),
    limit: vi.fn(),
    then: (resolve: (value: T) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve().then(read).then(resolve, reject),
  };
  query.session.mockReturnValue(query);
  query.sort.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  return query;
}

function same(left: unknown, right: unknown): boolean {
  return String((left as { toString?: () => string })?.toString?.() ?? left)
    === String((right as { toString?: () => string })?.toString?.() ?? right);
}

vi.mock('mongoose', () => ({
  default: {
    startSession: vi.fn(async () => ({
      withTransaction: async (operation: () => Promise<unknown>) => {
        let release!: () => void;
        const previous = state.transactionTail;
        state.transactionTail = new Promise<void>((resolve) => { release = resolve; });
        await previous;
        const snapshot = {
          root: state.root ? { ...state.root } : null,
          revisions: state.revisions.map((revision) => ({ ...revision })),
          runs: state.runs.map((run) => ({ ...run })),
        };
        try {
          return await operation();
        } catch (error) {
          state.root = snapshot.root;
          state.revisions = snapshot.revisions;
          state.runs = snapshot.runs;
          throw error;
        } finally {
          release();
        }
      },
      endSession: vi.fn(),
    })),
  },
}));

vi.mock('../models/Workflow.model', () => ({
  Workflow: {
    find: () => lazyQuery(() => state.root ? [state.root] : []),
    findById: (workflowId: unknown) => lazyQuery(() => (
      state.root && same(state.root._id, workflowId) ? state.root : null
    )),
    findOne: (filter: Record<string, unknown>) => lazyQuery(() => {
      if (!state.root
        || !same(state.root._id, filter._id)
        || (filter.userId !== undefined && state.root.userId !== filter.userId)) return null;
      return state.root;
    }),
    updateOne: (filter: Record<string, unknown>, update: { $set: Record<string, unknown> }) => lazyQuery(() => {
      if (state.failPointerUpdate) throw new Error('injected pointer failure');
      if (!state.root
        || !same(state.root._id, filter._id)
        || (filter.userId !== undefined && state.root.userId !== filter.userId)
        || (filter.currentRevision !== undefined && state.root.currentRevision !== filter.currentRevision)
        || (filter.currentRevisionId !== undefined && !same(state.root.currentRevisionId, filter.currentRevisionId))) {
        return { matchedCount: 0 };
      }
      Object.assign(state.root, update.$set, { updatedAt: new Date() });
      return { matchedCount: 1 };
    }),
    deleteOne: (filter: Record<string, unknown>) => lazyQuery(() => {
      if (state.root && same(state.root._id, filter._id) && state.root.userId === filter.userId) state.root = null;
      return { deletedCount: 1 };
    }),
  },
}));

vi.mock('../models/WorkflowRevision.model', () => ({
  WorkflowRevision: {
    collection: { name: 'workflowrevisions' },
    find: (filter: Record<string, unknown>) => lazyQuery(() => state.revisions.filter((revision) => (
      (filter.workflowId === undefined || same(revision.workflowId, filter.workflowId))
      && (filter.userId === undefined || revision.userId === filter.userId)
    ))),
    findOne: (filter: Record<string, unknown>) => lazyQuery(() => state.revisions.find((revision) => (
      (filter._id === undefined || same(revision._id, filter._id))
      && (filter.workflowId === undefined || same(revision.workflowId, filter.workflowId))
      && (filter.userId === undefined || revision.userId === filter.userId)
      && (filter.revision === undefined || revision.revision === filter.revision)
    )) ?? null),
    create: async (documents: Array<Record<string, unknown>>) => {
      const document = documents[0];
      if (state.revisions.some((revision) => same(revision.workflowId, document.workflowId) && revision.revision === document.revision)) {
        throw Object.assign(new Error('duplicate revision'), { code: 11000 });
      }
      const revision = {
        ...document,
        _id: id(`r${document.revision}`),
        workflowId: document.workflowId as { toString(): string },
        userId: String(document.userId),
        revision: Number(document.revision),
        createdAt: new Date(),
      };
      state.revisions.push(revision);
      return [revision];
    },
    deleteMany: (filter: Record<string, unknown>) => lazyQuery(() => {
      if (state.failRevisionDelete) throw new Error('injected revision delete failure');
      const before = state.revisions.length;
      state.revisions = state.revisions.filter((revision) => !(
        same(revision.workflowId, filter.workflowId) && revision.userId === filter.userId
      ));
      return { deletedCount: before - state.revisions.length };
    }),
  },
}));

vi.mock('../models/ExecutionRun.model', () => ({
  ExecutionRun: {
    collection: { name: 'executionruns' },
    deleteMany: (filter: Record<string, unknown>) => lazyQuery(() => {
      const before = state.runs.length;
      state.runs = state.runs.filter((run) => !(same(run.workflowId, filter.workflowId) && run.userId === filter.userId));
      return { deletedCount: before - state.runs.length };
    }),
  },
}));

import { calculateDefinitionHash } from './workflowDefinition';
import {
  createAiGeneratedWorkflowRevision,
  deleteWorkflow,
  migrateWorkflowRevisions,
  restoreWorkflowRevision,
  updateWorkflow,
} from './workflow.service';

const edges = [{ id: 'start-end', source: 'start', target: 'end' }];
function nodes(label: string) {
  return [
    { id: 'start', type: 'start' as const, label: 'Start', position: { x: 0, y: 0 }, config: {} },
    { id: 'end', type: 'end' as const, label, position: { x: 100, y: 0 }, config: {} },
  ];
}

beforeEach(() => {
  state.root = {
    _id: id('workflow-1'), userId: 'user-1', name: 'Workflow', isGeneratedByAI: false,
    currentRevisionId: id('r10'), currentRevision: 10,
    createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-10'),
  };
  state.revisions = Array.from({ length: 10 }, (_, index) => {
    const revision = index + 1;
    const definition = { nodes: nodes(`End v${revision}`), edges };
    return {
      _id: id(`r${revision}`), workflowId: id('workflow-1'), userId: 'user-1', revision,
      parentRevisionId: revision === 1 ? null : id(`r${revision - 1}`), source: 'manual',
      ...definition, definitionHash: calculateDefinitionHash(definition), createdAt: new Date(),
    };
  });
  state.runs = [{ _id: id('run-1'), workflowId: id('workflow-1'), userId: 'user-1' }];
  state.transactionTail = Promise.resolve();
  state.failPointerUpdate = false;
  state.failRevisionDelete = false;
});

const manual = (label: string) => updateWorkflow('workflow-1', 'user-1', {
  expectedRevision: 10,
  nodes: nodes(label),
  edges,
});
const ai = () => createAiGeneratedWorkflowRevision('workflow-1', 'user-1', 10, {
  name: 'AI workflow',
  nodes: nodes('End v10'),
  edges,
  generationMetadata: {
    originalPrompt: 'Keep the same graph', generatedAt: '2026-08-29T00:00:00.000Z',
    provider: 'test', model: 'test-model',
    capabilityCoverage: {
      requestedCapabilities: [], implementedCapabilities: [], missingCapabilities: [],
      unsupportedCapabilities: [], coverage: 1, isComplete: true,
    },
  },
});
const restore = (target: number) => restoreWorkflowRevision('workflow-1', 'user-1', target, { expectedRevision: 10 });

async function expectSingleWinner(operations: Array<Promise<unknown>>) {
  const settled = await Promise.allSettled(operations);
  expect(settled.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  const loser = settled.find((result) => result.status === 'rejected') as PromiseRejectedResult;
  expect(loser.reason).toMatchObject({ statusCode: 409, code: 'WORKFLOW_REVISION_CONFLICT' });
  expect(state.root?.currentRevision).toBe(11);
  expect(state.root?.currentRevisionId?.toString()).toBe('r11');
  expect(state.revisions.filter((revision) => revision.revision === 11)).toHaveLength(1);
  expect(state.revisions).toHaveLength(11);
}

describe('adversarial competing revision writes', () => {
  it('allows exactly one of two manual saves from v10', async () => {
    await expectSingleWinner([manual('Manual A'), manual('Manual B')]);
  });

  it('allows exactly one of manual and same-graph AI provenance from v10', async () => {
    await expectSingleWinner([manual('Manual winner candidate'), ai()]);
  });

  it('allows exactly one of restore and save from v10', async () => {
    await expectSingleWinner([restore(4), manual('Manual competitor')]);
  });

  it('allows exactly one of two restores from v10', async () => {
    await expectSingleWinner([restore(3), restore(5)]);
  });

  it('rolls back an inserted revision when pointer advancement throws', async () => {
    state.failPointerUpdate = true;
    await expect(manual('Uncommitted')).rejects.toThrow('injected pointer failure');
    expect(state.root?.currentRevision).toBe(10);
    expect(state.revisions).toHaveLength(10);
  });

  it('rolls back run deletion when workflow deletion fails midway', async () => {
    state.failRevisionDelete = true;
    await expect(deleteWorkflow('workflow-1', 'user-1')).rejects.toThrow('injected revision delete failure');
    expect(state.root).not.toBeNull();
    expect(state.revisions).toHaveLength(10);
    expect(state.runs).toHaveLength(1);
  });

  it('lets concurrent migration attempts converge on one revision 1 pointer', async () => {
    state.root = {
      _id: id('legacy-workflow'), userId: 'user-1', name: 'Legacy', isGeneratedByAI: false,
      nodes: nodes('Legacy end'), edges,
      createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'),
    };
    state.revisions = [];
    const options = { transactionCapabilityCheck: async () => {} };

    const [first, second] = await Promise.all([
      migrateWorkflowRevisions(undefined, options),
      migrateWorkflowRevisions(undefined, options),
    ]);

    expect(first.migrated + second.migrated).toBe(1);
    expect(first.alreadyMigrated + second.alreadyMigrated).toBe(1);
    expect(state.root.currentRevision).toBe(1);
    expect(state.root.currentRevisionId?.toString()).toBe('r1');
    expect(state.revisions).toHaveLength(1);
  });
});
