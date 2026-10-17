import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { calculateDefinitionHash, type WorkflowDefinition } from '../workflowDefinition';

const db = vi.hoisted(() => ({ workflow: vi.fn(), revision: vi.fn() }));
vi.mock('../../models/Workflow.model', () => ({ Workflow: { findOne: db.workflow } }));
vi.mock('../../models/WorkflowRevision.model', () => ({ WorkflowRevision: { findOne: db.revision } }));

import { simulateDefinitionIsolated, simulateDefinition, simulateOwnedWorkflow } from './workflowSimulation';

const definition: WorkflowDefinition = {
  nodes: [
    { id: 'start', type: 'start', label: 'Start', position: { x: 0, y: 0 }, config: {} },
    { id: 'fetch', type: 'api_call', label: 'Fetch', position: { x: 100, y: 0 },
      config: { url: 'https://example.com/issues', method: 'GET', headers: { Authorization: 'Bearer should-never-be-used' } } },
    { id: 'map', type: 'transform', label: 'Map', position: { x: 200, y: 0 },
      config: { transformCode: 'return { count: input.fetch.data.length, status: input.fetch.status };' } },
    { id: 'route', type: 'condition', label: 'Route', position: { x: 300, y: 0 },
      config: { expression: 'input.map.count > 0' } },
    { id: 'yes', type: 'output', label: 'Yes', position: { x: 400, y: -30 },
      config: { logLevel: 'info', message: 'Count {{map.count}}' } },
    { id: 'no', type: 'output', label: 'No', position: { x: 400, y: 30 },
      config: { logLevel: 'info', message: 'Zero issues' } },
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
  expectedRevision: 1,
  mode: 'isolated' as const,
  mocks: { fetch: { status: 200, data: [{ id: 1 }, { id: 2 }], headers: { authorization: 'Bearer sensitive-header' } } },
  assertions: [
    { nodeId: 'map', path: 'count', equals: 2 },
    { nodeId: 'yes', path: 'message', equals: 'Count 2' },
  ],
  expectedBranches: { route: 'true' as const },
};

beforeEach(() => {
  db.workflow.mockResolvedValue({ _id: 'w-1', userId: 'owner-1', currentRevision: 1, currentRevisionId: 'r-1' });
  db.revision.mockResolvedValue({
    _id: 'r-1', workflowId: 'w-1', userId: 'owner-1', revision: 1, source: 'manual',
    nodes: definition.nodes, edges: definition.edges, definitionHash: calculateDefinitionHash(definition),
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe('Test Lab isolated JS mode (real QuickJS, no host network)', () => {
  it('executes actual Transform/Condition logic over mocked API data and keeps branch assertions', async () => {
    const fetchSpy = vi.fn();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', fetchSpy);
    const result = await simulateDefinitionIsolated(definition, scenario);
    expect(result.mode).toBe('isolated');
    expect(result.status).toBe('passed');
    expect(result.steps.find((step) => step.nodeId === 'fetch')?.status).toBe('mocked');
    expect(result.steps.find((step) => step.nodeId === 'map')).toMatchObject({ status: 'simulated', output: { count: 2, status: 200 } });
    expect(result.steps.find((step) => step.nodeId === 'route')).toMatchObject({ status: 'simulated', output: { result: true, branchTaken: 'true' } });
    expect(result.steps.find((step) => step.nodeId === 'no')?.status).toBe('skipped');
    expect(result.assertions).toHaveLength(3);
    expect(result.assertions.every((check) => check.passed)).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('sensitive-header');
  }, 15_000);

  it('chooses false for an actual false expression and checks negative branch outcomes', async () => {
    const input = { ...scenario,
      mocks: { fetch: { status: 200, data: [] } },
      expectedBranches: { route: 'false' as const },
      assertions: [{ nodeId: 'no', path: 'message', equals: 'Zero issues' }],
    };
    const result = await simulateDefinitionIsolated(definition, input);
    expect(result.status).toBe('passed');
    expect(result.steps.find((step) => step.nodeId === 'yes')?.status).toBe('skipped');
    expect(result.steps.find((step) => step.nodeId === 'no')?.status).toBe('simulated');
  }, 15_000);

  it('reports failed expected outputs without leaking compared values', async () => {
    const result = await simulateDefinitionIsolated(definition, {
      ...scenario, assertions: [{ nodeId: 'map', path: 'count', equals: 999 }],
    });
    expect(result.status).toBe('failed');
    expect(result.assertions[0]).toMatchObject({ passed: false, message: 'Expected value did not match' });
    expect(JSON.stringify(result)).not.toContain('999');
  }, 15_000);

  it('rejects mock injection into real Transform/Condition nodes and never permits mock-only function to run JS', async () => {
    const bad = { ...scenario, mocks: { ...scenario.mocks, map: { count: 100 } } };
    await expect(simulateDefinitionIsolated(definition, bad)).rejects.toMatchObject({ code: 'INVALID_SIMULATION_MOCK' });
    expect(() => simulateDefinition(definition, scenario)).toThrowError(/isolated simulation runner/);
  });

  it('fails closed for missing API mocks and skips later scripts', async () => {
    const result = await simulateDefinitionIsolated(definition, { ...scenario, mocks: {} });
    expect(result).toMatchObject({ status: 'failed' });
    expect(result.steps.find((step) => step.nodeId === 'fetch')).toMatchObject({
      status: 'failed', error: 'SIMULATION_MOCK_REQUIRED',
    });
    expect(result.steps.find((step) => step.nodeId === 'map')?.status).toBe('skipped');
  });

  it('does not execute host globals through the QuickJS Function constructor', async () => {
    const graph: WorkflowDefinition = {
      ...definition, nodes: definition.nodes.map((node) => node.id === 'map'
        ? { ...node, config: { transformCode: 'return { proc: Function("return typeof process")(), net: typeof fetch, modules: typeof require };' } }
        : node),
    };
    const result = await simulateDefinitionIsolated(graph, {
      ...scenario, assertions: [{ nodeId: 'map', path: 'proc', equals: 'undefined' }], expectedBranches: {},
    });
    expect(result.steps.find((step) => step.nodeId === 'map')?.output).toEqual({
      proc: 'undefined', net: 'undefined', modules: 'undefined',
    });
    expect(result.assertions[0].passed).toBe(true);
  }, 15_000);

  it('turns malicious or malformed guest errors into static failure codes', async () => {
    const graph: WorkflowDefinition = {
      ...definition, nodes: definition.nodes.map((node) => node.id === 'map'
        ? { ...node, config: { transformCode: 'throw Error("secret=do-not-log");' } }
        : node),
    };
    const result = await simulateDefinitionIsolated(graph, scenario);
    expect(result.status).toBe('failed');
    expect(result.steps.find((step) => step.nodeId === 'map')).toMatchObject({
      status: 'failed', error: 'SCRIPT_GUEST_ERROR',
    });
    expect(JSON.stringify(result)).not.toContain('do-not-log');
  }, 15_000);

  it('interrupts infinite loops, reports limits, and never executes downstream steps', async () => {
    const graph: WorkflowDefinition = {
      ...definition, nodes: definition.nodes.map((node) => node.id === 'map'
        ? { ...node, config: { transformCode: 'while(true) {}' } }
        : node),
    };
    const result = await simulateDefinitionIsolated(graph, scenario);
    expect(result.status).toBe('failed');
    expect(result.steps.find((step) => step.nodeId === 'map')).toMatchObject({
      status: 'failed', error: 'SCRIPT_LIMIT_EXCEEDED',
    });
    expect(result.steps.find((step) => step.nodeId === 'route')?.status).toBe('skipped');
  }, 15_000);

  it('preserves ownership, integrity and revision pinning in the async endpoint path', async () => {
    const result = await simulateOwnedWorkflow('w-1', 'owner-1', scenario);
    expect(result).toMatchObject({
      status: 'passed', mode: 'isolated',
      provenance: { workflowRevision: 1, definitionHash: calculateDefinitionHash(definition) },
    });
    expect(db.workflow).toHaveBeenCalledWith({ _id: 'w-1', userId: 'owner-1' });
    db.workflow.mockResolvedValueOnce(null);
    await expect(simulateOwnedWorkflow('w-1', 'intruder', scenario)).rejects.toMatchObject({ statusCode: 404 });
    db.workflow.mockResolvedValueOnce({ _id: 'w-1', userId: 'owner-1', currentRevision: 2, currentRevisionId: 'r-2' });
    await expect(simulateOwnedWorkflow('w-1', 'owner-1', scenario)).rejects.toMatchObject({ statusCode: 409 });
  }, 15_000);
});
