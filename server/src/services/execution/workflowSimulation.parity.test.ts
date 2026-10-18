import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeTransform } from './executors/transform.executor';
import { executeCondition } from './executors/condition.executor';
import { executeOutput } from './executors/output.executor';
import { simulateDefinitionIsolated } from './workflowSimulation';
import type { ExecutionContext } from './templateEngine';
import type { WorkflowDefinition } from '../workflowDefinition';

type NodeType = WorkflowDefinition['nodes'][number]['type'];
type Node = WorkflowDefinition['nodes'][number];

function node(id: string, type: NodeType, config: Record<string, unknown> = {}): Node {
  return { id, type, label: id, config, position: { x: 0, y: 0 } };
}

function linear(...middle: Node[]): WorkflowDefinition {
  const nodes = [node('start', 'start'), ...middle, node('end', 'end')];
  return {
    nodes,
    edges: nodes.slice(1).map((target, index) => ({
      id: 'edge-' + index, source: nodes[index].id, target: target.id,
    })),
  };
}

const run = (definition: WorkflowDefinition, mocks: Record<string, Record<string, unknown>> = {},
  assertions: Array<{ nodeId: string; path?: string; equals: unknown }> = [],
  expectedBranches: Record<string, 'true' | 'false'> = {}) =>
  simulateDefinitionIsolated(definition, { expectedRevision: 1, mode: 'isolated', mocks, assertions, expectedBranches });

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('M6B isolated Test Lab / production compatibility — disposable QuickJS fixtures', () => {
  it('retains direct array Transform outputs through conditions, positional paths, templates and branch assertions', async () => {
    const definition: WorkflowDefinition = {
      nodes: [
        node('start', 'start'),
        node('items', 'transform', { transformCode: 'return [{ id: 1, active: true }, { id: 2, active: false }];' }),
        node('decision', 'condition', { expression: 'Array.isArray(input.items) && input.items.length === 2 && input.items[0].active' }),
        node('yes', 'output', { logLevel: 'info', message: 'Item {{items.0.id}} / {{items.1.id}}; branch {{prev.branchTaken}}' }),
        node('no', 'output', { logLevel: 'info', message: 'Wrong branch' }),
        node('end', 'end'),
      ],
      edges: [
        { id: 'a', source: 'start', target: 'items' },
        { id: 'b', source: 'items', target: 'decision' },
        { id: 'c', source: 'decision', target: 'yes', conditionBranch: 'true' },
        { id: 'd', source: 'decision', target: 'no', conditionBranch: 'false' },
        { id: 'e', source: 'yes', target: 'end' },
        { id: 'f', source: 'no', target: 'end' },
      ],
    };
    const logs = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const noNetwork = vi.fn();
    vi.stubGlobal('fetch', noNetwork);
    const result = await run(definition, {}, [
      { nodeId: 'items', equals: [{ id: 1, active: true }, { id: 2, active: false }] },
      { nodeId: 'items', path: '0.id', equals: 1 },
      { nodeId: 'yes', path: 'message', equals: 'Item 1 / 2; branch true' },
    ], { decision: 'true' });
    expect(result.status).toBe('passed');
    expect(result.assertions).toHaveLength(4);
    expect(result.assertions.every((item) => item.passed)).toBe(true);
    expect(result.steps.find((step) => step.nodeId === 'items')?.output).toEqual([{ id: 1, active: true }, { id: 2, active: false }]);
    expect(result.steps.find((step) => step.nodeId === 'no')?.status).toBe('skipped');
    expect(noNetwork).not.toHaveBeenCalled();
    expect(logs).not.toHaveBeenCalled();

    const prod = await executeTransform({
      nodeId: 'items', context: new Map(),
      config: { transformCode: 'return [{ id: 1, active: true }, { id: 2, active: false }];' },
    });
    expect(result.steps.find((step) => step.nodeId === 'items')?.output).toEqual(prod.output);
  }, 20_000);

  it('preserves empty arrays, array length and direct null/scalar wrappers', async () => {
    const definition = linear(
      node('empty', 'transform', { transformCode: 'return [];' }),
      node('count', 'transform', { transformCode: 'return input.empty.length;' }),
      node('nil', 'transform', { transformCode: 'return null;' }),
      node('output', 'output', { logLevel: 'info', message: 'array={{empty}} length={{empty.length}} count={{count.data}} null={{nil.data}}' }),
    );
    const result = await run(definition, {}, [
      { nodeId: 'empty', equals: [] },
      { nodeId: 'count', equals: { data: 0 } },
      { nodeId: 'nil', equals: { data: null } },
      { nodeId: 'output', path: 'message', equals: 'array=[] length=0 count=0 null=' },
    ]);
    expect(result.status).toBe('passed');
    expect(result.steps.find((step) => step.nodeId === 'empty')?.output).toEqual([]);
  }, 20_000);

  it('matches the production Output template for long, simple saved field names while denying prototype paths', async () => {
    const key = 'long_field_' + 'x'.repeat(160);
    const code = 'return { ' + JSON.stringify(key) + ': 7, safe: true };';
    const message = 'value={{values.' + key + '}} unsafe={{values.__proto__}} safe={{values.safe}}';
    const definition = linear(
      node('values', 'transform', { transformCode: code }),
      node('output', 'output', { logLevel: 'info', message }),
    );
    const result = await run(definition);
    expect(result.status).toBe('passed');
    const expected = 'value=7 unsafe= safe=true';
    expect(result.steps.find((step) => step.nodeId === 'output')?.output).toMatchObject({ message: expected });

    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const productionContext: ExecutionContext = new Map([['values', { [key]: 7, safe: true }]]);
    const prod = await executeOutput({
      nodeId: 'output', config: { logLevel: 'info', message: 'value={{values.' + key + '}} safe={{values.safe}}' },
      context: productionContext,
    });
    expect(prod.output.message).toBe('value=7 safe=true');
  }, 20_000);

  it('keeps mocked API traffic offline and redacts sensitive fields before downstream scripts consume them', async () => {
    const definition = linear(
      node('fetch', 'api_call', { url: 'https://example.test/private', method: 'GET', headers: {} }),
      node('map', 'transform', { transformCode: 'return { publicId: input.fetch.data.id, masked: input.fetch.data.apiKey };' }),
    );
    const noNetwork = vi.fn();
    vi.stubGlobal('fetch', noNetwork);
    const result = await run(definition,
      { fetch: { status: 200, data: { id: 4, apiKey: 'do-not-disclose' }, headers: { Authorization: 'Bearer sensitive-demo' } } },
      [{ nodeId: 'map', path: 'masked', equals: '[REDACTED]' }, { nodeId: 'map', path: 'publicId', equals: 4 }]);
    expect(result.status).toBe('passed');
    expect(result.steps.find((step) => step.nodeId === 'fetch')?.status).toBe('mocked');
    expect(JSON.stringify(result)).not.toMatch(/do-not-disclose|sensitive-demo/);
    expect(noNetwork).not.toHaveBeenCalled();
  }, 20_000);

  it('fails closed on invalid Transform source, keeping guest errors out of response data', async () => {
    const definition = linear(
      node('bad', 'transform', { transformCode: 'throw new Error("password=synthetic-sensitive");' }),
      node('unreached', 'transform', { transformCode: 'return { ran: true };' }),
    );
    const result = await run(definition);
    expect(result.status).toBe('failed');
    expect(result.steps.find((step) => step.nodeId === 'bad')).toMatchObject({
      status: 'failed', error: 'SCRIPT_GUEST_ERROR',
    });
    expect(result.steps.find((step) => step.nodeId === 'unreached')?.status).toBe('skipped');
    expect(JSON.stringify(result)).not.toContain('synthetic-sensitive');
  }, 20_000);

  it('does not confuse the intentionally different Condition guest-error handling with parity', async () => {
    const definition = linear(node('branch', 'condition', { expression: 'unknownSavedVariable.value' }));
    const lab = await run(definition);
    expect(lab.status).toBe('failed');
    expect(lab.steps.find((step) => step.nodeId === 'branch')).toMatchObject({
      status: 'failed', error: 'SCRIPT_GUEST_ERROR',
    });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const prod = await executeCondition({
      nodeId: 'branch', config: { expression: 'unknownSavedVariable.value' }, context: new Map(),
    });
    expect(prod.output).toMatchObject({ result: false, branchTaken: 'false' });
  }, 20_000);

  it('fails closed on script resource limits without running downstream nodes', async () => {
    const result = await run(linear(
      node('loop', 'transform', { transformCode: 'while(true) {}' }),
      node('unreached', 'output', { logLevel: 'info', message: 'must not run' }),
    ));
    expect(result.status).toBe('failed');
    expect(result.steps.find((step) => step.nodeId === 'loop')).toMatchObject({
      status: 'failed', error: 'SCRIPT_LIMIT_EXCEEDED',
    });
    expect(result.steps.find((step) => step.nodeId === 'unreached')?.status).toBe('skipped');
  }, 20_000);

  it('rejects more than twelve script nodes before executing any user source', async () => {
    const scripts = Array.from({ length: 13 }, (_, i) => node('script-' + i, 'transform', { transformCode: 'return {};' }));
    await expect(run(linear(...scripts))).rejects.toMatchObject({
      statusCode: 413, code: 'SIMULATION_SCRIPT_LIMIT',
    });
  });
});
