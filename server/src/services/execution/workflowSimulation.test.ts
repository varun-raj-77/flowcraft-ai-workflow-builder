import { beforeEach, describe, expect, it, vi } from 'vitest';
import { calculateDefinitionHash, type WorkflowDefinition } from '../workflowDefinition';

const mocks = vi.hoisted(() => ({ workflowFind: vi.fn(), revisionFind: vi.fn() }));
vi.mock('../../models/Workflow.model', () => ({ Workflow: { findOne: mocks.workflowFind } }));
vi.mock('../../models/WorkflowRevision.model', () => ({ WorkflowRevision: { findOne: mocks.revisionFind } }));

import { simulateDefinition, simulateOwnedWorkflow } from './workflowSimulation';

const definition: WorkflowDefinition = {
  nodes: [
    { id: 'start', type: 'start', label: 'Start', position: { x: 0, y: 0 }, config: {} },
    { id: 'fetch', type: 'api_call', label: 'Fetch', position: { x: 100, y: 0 },
      config: { url: 'https://example.test/secret', method: 'GET', headers: { authorization: 'Bearer secret' } } },
    { id: 'map', type: 'transform', label: 'Map', position: { x: 200, y: 0 },
      config: { transformCode: "throw new Error('THIS CODE MUST NOT RUN');" } },
    { id: 'route', type: 'condition', label: 'Route', position: { x: 300, y: 0 },
      config: { expression: 'process.exit(1)', trueTargetNodeId: 'yes', falseTargetNodeId: 'no' } },
    { id: 'yes', type: 'output', label: 'Yes', position: { x: 400, y: -50 },
      config: { logLevel: 'info', message: 'Count {{map.count}}' } },
    { id: 'no', type: 'output', label: 'No', position: { x: 400, y: 50 },
      config: { logLevel: 'info', message: 'Wrong path' } },
    { id: 'end', type: 'end', label: 'End', position: { x: 500, y: 0 }, config: {} },
  ],
  edges: [
    { id: 'a', source: 'start', target: 'fetch' },
    { id: 'b', source: 'fetch', target: 'map' },
    { id: 'c', source: 'map', target: 'route' },
    { id: 'd', source: 'route', target: 'yes', conditionBranch: 'true' },
    { id: 'e', source: 'route', target: 'no', conditionBranch: 'false' },
    { id: 'f', source: 'yes', target: 'end' },
    { id: 'g', source: 'no', target: 'end' },
  ],
};

const scenario = {
  expectedRevision: 2,
  mocks: {
    fetch: { status: 200, data: [{ id: 1 }], headers: { 'content-type': 'application/json' } },
    map: { count: 1 },
    route: { branchTaken: 'true' },
  },
  assertions: [
    { nodeId: 'fetch', path: 'status', equals: 200 },
    { nodeId: 'map', path: 'count', equals: 1 },
    { nodeId: 'yes', path: 'message', equals: 'Count 1' },
  ],
  expectedBranches: { route: 'true' },
};

function fakeRevision() {
  return {
    _id: 'rev-2',
    workflowId: 'wf-1',
    userId: 'owner-1',
    revision: 2,
    source: 'manual',
    nodes: definition.nodes,
    edges: definition.edges,
    definitionHash: calculateDefinitionHash(definition),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.workflowFind.mockResolvedValue({
    _id: 'wf-1', userId: 'owner-1', currentRevision: 2, currentRevisionId: 'rev-2',
  });
  mocks.revisionFind.mockResolvedValue(fakeRevision());
});

describe('FlowCraft safe simulation foundation', () => {
  it('runs mocked API/transform/condition paths and assertions without network or code execution', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('NETWORK REQUEST MUST NEVER OCCUR');
    });
    const result = simulateDefinition(definition, scenario);
    expect(result.status).toBe('passed');
    expect(result.assertions).toHaveLength(4);
    expect(result.assertions.every((test) => test.passed)).toBe(true);
    expect(result.steps.find((step) => step.nodeId === 'fetch')?.status).toBe('mocked');
    expect(result.steps.find((step) => step.nodeId === 'map')?.status).toBe('mocked');
    expect(result.steps.find((step) => step.nodeId === 'route')?.status).toBe('mocked');
    expect(result.steps.find((step) => step.nodeId === 'no')?.status).toBe('skipped');
    expect(result.steps.find((step) => step.nodeId === 'yes')?.output).toMatchObject({ message: 'Count 1' });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    expect(JSON.stringify(result)).not.toContain('Bearer secret');
    expect(JSON.stringify(result)).not.toContain('THIS CODE MUST NOT RUN');
    expect(JSON.stringify(result)).not.toContain('process.exit');
  });

  it('fails closed on missing mocks, never contacting an external endpoint', () => {
    const result = simulateDefinition(definition, { expectedRevision: 2 });
    expect(result.status).toBe('failed');
    expect(result.steps.find((step) => step.nodeId === 'fetch')).toMatchObject({
      status: 'failed', error: 'SIMULATION_MOCK_REQUIRED',
    });
    expect(result.steps.find((step) => step.nodeId === 'map')?.status).toBe('skipped');
  });

  it('reports mismatching expected values and branches without exposing expected data', () => {
    const result = simulateDefinition(definition, {
      ...scenario,
      assertions: [{ nodeId: 'map', path: 'count', equals: 42 }],
      expectedBranches: { route: 'false' },
    });
    expect(result.status).toBe('failed');
    expect(result.assertions).toHaveLength(2);
    expect(result.assertions.every((test) => !test.passed)).toBe(true);
    expect(JSON.stringify(result)).not.toContain('42');
  });

  it('runs Delay in simulated time without timers and never logs Output to stdout', () => {
    const sleep = vi.spyOn(globalThis, 'setTimeout');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const graph: WorkflowDefinition = {
      nodes: [
        definition.nodes[0],
        { id: 'wait', type: 'delay', label: 'Wait', position: { x: 10, y: 0 }, config: { delayMs: 300000 } },
        { id: 'log', type: 'output', label: 'Log', position: { x: 20, y: 0 },
          config: { logLevel: 'info', message: 'Waited {{wait.delayedMs}} milliseconds' } },
        definition.nodes[6],
      ],
      edges: [
        { id: 'a', source: 'start', target: 'wait' },
        { id: 'b', source: 'wait', target: 'log' },
        { id: 'c', source: 'log', target: 'end' },
      ],
    };
    const result = simulateDefinition(graph, {
      expectedRevision: 2,
      assertions: [{ nodeId: 'log', path: 'message', equals: 'Waited 300000 milliseconds' }],
    });
    expect(result.status).toBe('passed');
    expect(sleep).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    sleep.mockRestore();
    log.mockRestore();
  });

  it('rejects malformed, unknown and oversized scenarios before execution', () => {
    expect(() => simulateDefinition(definition, { expectedRevision: 2, mocks: { no: {} } }))
      .toThrowError(/Mocks can only target/);
    expect(() => simulateDefinition(definition, { expectedRevision: 2, mocks: { route: { branchTaken: 'maybe' } } }))
      .toThrowError(/Condition mocks/);
    expect(() => simulateDefinition(definition, { expectedRevision: 2, assertions: [{ nodeId: 'map', path: '__proto__.constructor', equals: 1 }] }))
      .toThrowError(/Assertions must reference/);
    expect(() => simulateDefinition(definition, { expectedRevision: 2, mocks: { map: { padding: 'X'.repeat(51_000) } } }))
      .toThrowError(/50 KB/);
    expect(() => simulateDefinition(definition, { expectedRevision: 2, expectedBranches: { fetch: 'true' } }))
      .toThrowError(/Branch assertions/);
  });

  it('does not mutate the caller fixtures or workflow definition', () => {
    const original = JSON.stringify(definition);
    const fixtures = JSON.stringify(scenario);
    simulateDefinition(definition, scenario);
    expect(JSON.stringify(definition)).toBe(original);
    expect(JSON.stringify(scenario)).toBe(fixtures);
  });

  it('requires ownership and refuses stale revision before loading the revision', async () => {
    mocks.workflowFind.mockResolvedValueOnce(null);
    await expect(simulateOwnedWorkflow('wf-1', 'other-user', scenario))
      .rejects.toMatchObject({ code: 'WORKFLOW_NOT_FOUND', statusCode: 404 });
    mocks.workflowFind.mockResolvedValueOnce({
      _id: 'wf-1', userId: 'owner-1', currentRevision: 3, currentRevisionId: 'rev-3',
    });
    await expect(simulateOwnedWorkflow('wf-1', 'owner-1', scenario))
      .rejects.toMatchObject({ code: 'WORKFLOW_REVISION_CONFLICT', statusCode: 409 });
    expect(mocks.revisionFind).not.toHaveBeenCalled();
    expect(mocks.workflowFind).toHaveBeenCalledWith({ _id: 'wf-1', userId: 'other-user' });
  });

  it('returns verified pinned provenance without writing any run or revision', async () => {
    const result = await simulateOwnedWorkflow('wf-1', 'owner-1', scenario);
    expect(result).toMatchObject({
      status: 'passed',
      provenance: { workflowRevision: 2, definitionHash: fakeRevision().definitionHash },
    });
    expect(mocks.revisionFind).toHaveBeenCalledWith({
      _id: 'rev-2', workflowId: 'wf-1', userId: 'owner-1', revision: 2,
    });
  });

  it('rejects altered revision contents before considering fixtures', async () => {
    mocks.revisionFind.mockResolvedValueOnce({ ...fakeRevision(), definitionHash: 'a'.repeat(64) });
    await expect(simulateOwnedWorkflow('wf-1', 'owner-1', scenario))
      .rejects.toMatchObject({ code: 'WORKFLOW_REVISION_INTEGRITY_ERROR' });
  });
});
