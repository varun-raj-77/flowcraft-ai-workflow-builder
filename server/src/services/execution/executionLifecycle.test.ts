import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { calculateDefinitionHash } from '../workflowDefinition';

const mocks = vi.hoisted(() => ({
  revisionFind: vi.fn(),
  requestHttp: vi.fn(),
  emit: vi.fn(),
  to: vi.fn(),
  events: [] as string[],
}));
vi.mock('../../models/Workflow.model', () => ({
  Workflow: { findOne: vi.fn(), updateOne: vi.fn() },
}));
vi.mock('../../models/WorkflowRevision.model', () => ({
  WorkflowRevision: { findOne: mocks.revisionFind },
}));
vi.mock('../../models/ExecutionRun.model', () => ({
  ExecutionRun: { findOne: vi.fn(), find: vi.fn(), create: vi.fn() },
}));
vi.mock('./executors/publicHttpTransport', () => ({
  requestPublicHttp: mocks.requestHttp,
}));
vi.mock('../../config/socket', () => ({
  getIO: () => ({
    to: mocks.to,
  }),
}));

import { runExecution } from './executionEngine';

const oid = (value: string) => ({ toString: () => value });
const startNode = {
  id: 'start', type: 'start' as const, label: 'Start',
  position: { x: 0, y: 0 }, config: {},
};
const endNode = {
  id: 'end', type: 'end' as const, label: 'End',
  position: { x: 20, y: 0 }, config: {},
};
const apiNode = {
  id: 'fetch', type: 'api_call' as const, label: 'Fetch password=top-secret-label',
  position: { x: 10, y: 0 },
  config: { url: 'https://example.test/api', method: 'GET' as const, headers: {} },
};
const plainNodes = [startNode, endNode];
const plainEdges = [{ id: 'edge', source: 'start', target: 'end' }];
const apiNodes = [startNode, apiNode, endNode];
const apiEdges = [
  { id: 'edge-1', source: 'start', target: 'fetch' },
  { id: 'edge-2', source: 'fetch', target: 'end' },
];

function revision(withApi = false) {
  const nodes = withApi ? apiNodes : plainNodes;
  const edges = withApi ? apiEdges : plainEdges;
  return {
    _id: oid('revision-1'),
    workflowId: oid('workflow-1'),
    userId: 'owner-1',
    revision: 1,
    definitionHash: calculateDefinitionHash({ nodes, edges }),
    parentRevisionId: null,
    source: 'manual',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    nodes, edges,
  };
}
type StepStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped';
type MockStep = {
  nodeId: string;
  nodeType: string;
  nodeLabel: string;
  status: StepStatus;
  startedAt?: Date;
  completedAt?: Date;
  durationMs?: number;
  error?: string;
};

function run(withApi = false) {
  const r = revision(withApi);
  const stepLogs: MockStep[] = r.nodes.map((node) => ({
    nodeId: node.id, nodeType: node.type, nodeLabel: node.label,
    status: 'pending',
  }));
  const mock = {
    _id: oid('execution-1'),
    workflowId: oid('workflow-1'),
    workflowRevisionId: oid('revision-1'),
    workflowRevision: 1,
    definitionHash: r.definitionHash,
    userId: 'owner-1',
    status: 'running',
    error: undefined as string | undefined,
    startedAt: new Date(),
    completedAt: undefined as Date | undefined,
    executionOrder: r.nodes.map((n) => n.id),
    stepLogs,
    markModified: vi.fn(),
    save: vi.fn().mockImplementation(async () => {
      mocks.events.push('save');
    }),
  };
  return mock;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.events.length = 0;
  mocks.revisionFind.mockResolvedValue(revision());
  mocks.to.mockImplementation((room: string) => {
    expect(room).toBe('execution:execution-1');
    return { emit: (event: string, data: unknown) => {
      mocks.events.push('emit:' + event);
      mocks.emit(event, data);
    } };
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('M8 persisted execution lifecycle finalization', () => {
  it('completes a valid graph and sends terminal success only after saving', async () => {
    const current = run();
    const result = await runExecution(current as never);
    expect(result.status).toBe('completed');
    expect(current.stepLogs.map((s) => s.status)).toEqual(['success', 'success']);
    expect(current.completedAt).toBeInstanceOf(Date);
    expect(mocks.emit).toHaveBeenCalledWith('execution:complete', expect.objectContaining({
      runId: 'execution-1', status: 'completed',
    }));
    expect(mocks.events.indexOf('save')).toBeLessThan(mocks.events.indexOf('emit:execution:complete'));
    expect(mocks.emit.mock.calls.filter((call) => call[0] === 'execution:complete')).toHaveLength(1);
  });

  it('fails a legacy run without revision, skipping pending work and notifying clients', async () => {
    const current = run();
    current.workflowRevisionId = undefined as never;
    const result = await runExecution(current as never);
    expect(result.status).toBe('failed');
    expect(result.error).toBe('Execution run has no pinned workflow revision');
    expect(result.stepLogs.every((s) => s.status === 'skipped')).toBe(true);
    expect(mocks.revisionFind).not.toHaveBeenCalled();
    expect(current.markModified).toHaveBeenCalledWith('stepLogs');
    expect(mocks.emit).toHaveBeenCalledWith('execution:complete', expect.objectContaining({
      status: 'failed', error: result.error,
    }));
    expect(mocks.events).toEqual(['save', 'emit:execution:complete']);
  });

  it('reports a missing immutable revision as a terminal failure without running nodes', async () => {
    const current = run();
    mocks.revisionFind.mockResolvedValueOnce(null);
    const result = await runExecution(current as never);
    expect(result).toMatchObject({ status: 'failed', error: 'Pinned workflow revision not found' });
    expect(current.stepLogs.every((s) => s.status === 'skipped')).toBe(true);
    expect(mocks.emit).toHaveBeenCalledWith('execution:complete', expect.objectContaining({
      status: 'failed',
    }));
  });

  it('turns a DB revision lookup outage into a safe terminal result instead of a stuck running run', async () => {
    const current = run();
    mocks.revisionFind.mockRejectedValueOnce(new Error('MongoDB password=ultra-sensitive'));
    const result = await runExecution(current as never);
    expect(result).toMatchObject({ status: 'failed', error: 'Execution failed unexpectedly' });
    expect(current.stepLogs.every((s) => s.status === 'skipped')).toBe(true);
    expect(JSON.stringify(result)).not.toContain('ultra-sensitive');
    expect(current.save).toHaveBeenCalledOnce();
    expect(mocks.events).toEqual(['save', 'emit:execution:complete']);
  });

  it('fails invalid saved revision integrity without exposing validation errors or saved code', async () => {
    const current = run();
    mocks.revisionFind.mockResolvedValueOnce({
      ...revision(), definitionHash: current.definitionHash,
      nodes: [{ ...startNode, label: 'password=synthetic-secret' }, endNode],
    });
    const result = await runExecution(current as never);
    expect(result).toMatchObject({ status: 'failed', error: 'Pinned workflow revision failed validation' });
    expect(mocks.emit).toHaveBeenCalledWith('execution:complete', expect.objectContaining({
      status: 'failed', error: 'Pinned workflow revision failed validation',
    }));
    expect(result.error).not.toContain('synthetic-secret');
  });

  it('marks an interrupted running step failed and pending steps skipped after an engine exception', async () => {
    const current = run();
    current.stepLogs[0].status = 'success';
    current.stepLogs[1].status = 'running';
    current.stepLogs[1].startedAt = new Date(Date.now() - 50);
    current.executionOrder = null as never; // Corrupt runtime bookkeeping, not saved graph.
    const result = await runExecution(current as never);
    expect(result.status).toBe('failed');
    expect(current.stepLogs[0].status).toBe('success');
    expect(current.stepLogs[1]).toMatchObject({ status: 'failed', error: 'Execution failed unexpectedly' });
    expect(current.stepLogs[1].durationMs).toBeGreaterThanOrEqual(0);
    expect(current.stepLogs[1].completedAt).toBeInstanceOf(Date);
    expect(mocks.emit).toHaveBeenCalledWith('execution:complete', expect.objectContaining({ status: 'failed' }));
  });

  it('redacts user-controlled node labels in terminal error while preserving the failing step diagnosis', async () => {
    const current = run(true);
    mocks.revisionFind.mockResolvedValueOnce(revision(true));
    mocks.requestHttp.mockRejectedValueOnce(new Error('HTTP error password=synthetic-private'));
    const result = await runExecution(current as never);
    expect(result.status).toBe('failed');
    expect(current.stepLogs.map((s) => s.status)).toEqual(['success', 'failed', 'skipped']);
    expect(result.error).not.toContain('top-secret-label');
    expect(result.error).not.toContain('synthetic-private');
    expect(result.error).toContain('[REDACTED]');
    expect(mocks.emit).toHaveBeenCalledWith('execution:complete', expect.objectContaining({
      status: 'failed', error: result.error,
    }));
  });

  it('never emits completion if persisting the final state fails', async () => {
    const current = run();
    current.workflowRevisionId = undefined as never;
    current.save.mockRejectedValue(new Error('database unavailable'));
    await expect(runExecution(current as never)).rejects.toThrow('database unavailable');
    expect(mocks.emit.mock.calls.filter(([type]) => type === 'execution:complete')).toHaveLength(0);
  });

  it('preserves the full immutable revision lookup including ownership and hash', async () => {
    const current = run();
    await runExecution(current as never);
    expect(mocks.revisionFind).toHaveBeenCalledWith(expect.objectContaining({
      workflowId: current.workflowId,
      userId: current.userId,
      revision: current.workflowRevision,
      definitionHash: current.definitionHash,
    }));
  });
});
