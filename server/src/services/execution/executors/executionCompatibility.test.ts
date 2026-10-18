import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeTransform } from './transform.executor';
import { executeCondition } from './condition.executor';
import { executeOutput } from './output.executor';
import { executeIsolatedScript } from './isolatedScriptRunner';
import { simulateDefinitionIsolated } from '../workflowSimulation';
import type { ExecutionContext } from '../templateEngine';
import type { WorkflowDefinition } from '../../workflowDefinition';

const context = (): ExecutionContext => new Map([
  ['fetch', { status: 200, data: [{ id: 1, active: true }, { id: 2, active: false }] }],
]);

afterEach(() => vi.restoreAllMocks());

describe('M6A disposable saved-workflow contract compatibility', () => {
  it('retains the production Transform contract for objects, arrays, scalar and null results', async () => {
    const cases: Array<[string, unknown]> = [
      ['return { count: input.fetch.data.length, firstId: prev.data[0].id, same: nodes.fetch.status === 200 };',
        { count: 2, firstId: 1, same: true }],
      ['return input.fetch.data.filter((item) => item.active).map((item) => item.id);', [1]],
      ['return input.fetch.status;', { data: 200 }],
      ['return null;', { data: null }],
    ];
    for (const [code, expected] of cases) {
      const result = await executeTransform({
        nodeId: 'transform', config: { transformCode: code }, context: context(),
      });
      expect(result.output).toEqual(expected);
    }
  }, 25_000);

  it('preserves production Condition true, false and legacy guest-error false-branch behavior', async () => {
    const trueBranch = await executeCondition({
      nodeId: 'condition', config: { expression: '{{fetch.status}} === 200 && input.fetch.data.some(item => item.active)' },
      context: context(),
    });
    const falseBranch = await executeCondition({
      nodeId: 'condition', config: { expression: 'input.fetch.data.every(item => item.active)' }, context: context(),
    });
    const badExpression = await executeCondition({
      nodeId: 'condition', config: { expression: 'missingLegacyField.deep.property' }, context: context(),
    });
    expect(trueBranch.output).toMatchObject({ result: true, branchTaken: 'true' });
    expect(falseBranch.output).toMatchObject({ result: false, branchTaken: 'false' });
    expect(badExpression.output).toMatchObject({ result: false, branchTaken: 'false' });
    expect(badExpression.output.evalError).toBeTruthy();
  }, 25_000);

  it('redacts JSON templated by an Output node in both the result and stdout', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const runtime: ExecutionContext = new Map([['fetch', {
      data: { credentials: { username: 'demo-owner', password: 'never-print-me' }, count: 2 },
    }]]);
    const result = await executeOutput({
      nodeId: 'output', config: { logLevel: 'info', message: '{{fetch.data}}' }, context: runtime,
    });
    const message = result.output.message as string;
    expect(JSON.parse(message)).toEqual({ credentials: '[REDACTED]', count: 2 });
    expect(log).toHaveBeenCalledWith('[workflow:INFO]', message);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/never-print-me|demo-owner/);
  });

  it('redacts guest JSON errors from Transform diagnostic text, source and stack', async () => {
    let diagnostic: unknown;
    try {
      await executeTransform({
        nodeId: 'transform',
        config: { transformCode: 'throw Error(JSON.stringify({password:"private-diagnostic",count:1}));' },
        context: context(),
      });
    } catch (error) {
      diagnostic = error;
    }
    expect(diagnostic).toMatchObject({
      name: 'TransformExecutionError',
      diagnostic: { code: 'TRANSFORM_EXECUTION_FAILED' },
    });
    expect(JSON.stringify(diagnostic)).not.toContain('private-diagnostic');
  }, 12_000);

  it('rejects oversized scripts without changing production workflow data', async () => {
    await expect(executeIsolatedScript('transform', 'x'.repeat(17_000), {
      input: {}, prev: {}, nodes: {},
    })).rejects.toMatchObject({ code: 'SCRIPT_LIMIT_EXCEEDED' });
  });

  it('documents the current Test Lab array-output mismatch instead of changing production output', async () => {
    const definition: WorkflowDefinition = {
      nodes: [
        { id: 'start', type: 'start', label: 'Start', position: { x: 0, y: 0 }, config: {} },
        { id: 'transform', type: 'transform', label: 'Array Transform', position: { x: 100, y: 0 },
          config: { transformCode: 'return [{ id: 1 }, { id: 2 }];' } },
        { id: 'end', type: 'end', label: 'End', position: { x: 200, y: 0 }, config: {} },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'transform' },
        { id: 'e2', source: 'transform', target: 'end' },
      ],
    };
    const prod = await executeTransform({
      nodeId: 'transform', config: { transformCode: 'return [{ id: 1 }, { id: 2 }];' }, context: new Map(),
    });
    const lab = await simulateDefinitionIsolated(definition, {
      expectedRevision: 1, mode: 'isolated', mocks: {}, assertions: [],
    });
    expect(prod.output).toEqual([{ id: 1 }, { id: 2 }]);
    expect(lab.status).toBe('passed');
    expect(lab.steps.find((step) => step.nodeId === 'transform')?.output).toEqual({
      data: [{ id: 1 }, { id: 2 }],
    });
  }, 15_000);
});
