import { describe, expect, it } from 'vitest';
import { executeTransform } from './transform.executor';
import { executeCondition } from './condition.executor';
import { executeIsolatedScript, IsolatedScriptError } from './isolatedScriptRunner';
import type { TransformExecutionError } from './transformDiagnostics';
import type { ExecutionContext } from '../templateEngine';

const context = (): ExecutionContext => new Map([
  ['fetch', {
    status: 200,
    data: [
      { id: 1, state: 'open', labels: [{ name: 'bug' }] },
      { id: 2, state: 'closed', labels: [] },
    ],
    headers: { 'content-type': 'application/json' },
  }],
]);

describe('isolated WebAssembly JavaScript execution', () => {
  it('keeps the Transform input/prev/nodes contract and common ES2020 array operations', async () => {
    const code = [
      "const issues = input.fetch.data;",
      "if (!Array.isArray(issues)) throw new Error('Expected an array');",
      "const open = issues.filter((issue) => issue.state === 'open').map((issue) => ({ id: issue.id }));",
      "return { open, total: Object.values(input).length, prevStatus: prev.status, same: nodes.fetch.status === 200 };",
    ].join('\n');
    const result = await executeTransform({ nodeId: 'transform', config: { transformCode: code }, context: context() });
    expect(result.output).toEqual({ open: [{ id: 1 }], total: 1, prevStatus: 200, same: true });
  }, 12_000);

  it('evaluates supported Condition expressions and template expansions without host execution', async () => {
    const expression = "Object.values(input.fetch.data).some((issue) => issue.state === 'open')";
    const result = await executeCondition({ nodeId: 'branch', config: { expression }, context: context() });
    expect(result.output).toMatchObject({ result: true, branchTaken: 'true' });
    const template = await executeCondition({ nodeId: 'branch', config: { expression: '{{fetch.status}} === 200' }, context: context() });
    expect(template.output).toMatchObject({ result: true, branchTaken: 'true' });
  }, 12_000);

  it('does not expose process, require, fetch, console, or environment secrets to user JavaScript', async () => {
    const result = await executeTransform({ nodeId: 'transform', config: {
      transformCode: 'return { process: typeof process, require: typeof require, fetch: typeof fetch, console: typeof console, env: typeof globalThis.process };',
    }, context: context() });
    expect(result.output).toEqual({
      process: 'undefined', require: 'undefined', fetch: 'undefined', console: 'undefined', env: 'undefined',
    });
  }, 12_000);

  it('cannot escape through Function constructor into the Node process', async () => {
    const result = await executeTransform({ nodeId: 'transform', config: {
      transformCode: 'return { result: Function("return typeof process")() };',
    }, context: context() });
    expect(result.output).toEqual({ result: 'undefined' });
  }, 12_000);

  it('interrupts an infinite Transform loop instead of blocking the API server', async () => {
    const start = Date.now();
    await expect(executeIsolatedScript('transform', 'while (true) {}', { input: {}, prev: {}, nodes: {} }))
      .rejects.toBeInstanceOf(IsolatedScriptError);
    expect(Date.now() - start).toBeLessThan(6_000);
    // The worker is killable; normal executions still succeed afterward.
    await expect(executeIsolatedScript('condition', '1 + 1 === 2', { input: {}, prev: {}, nodes: {} }))
      .resolves.toBe(true);
  }, 12_000);

  it('denies oversized or cyclic inputs before allocating a worker', async () => {
    await expect(executeIsolatedScript('transform', 'return 1;', {
      input: { oversized: { value: 'x'.repeat(280_000) } }, prev: {}, nodes: {},
    })).rejects.toMatchObject({ code: 'SCRIPT_LIMIT_EXCEEDED' });
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    await expect(executeIsolatedScript('transform', 'return 1;', {
      input: { cyclic }, prev: {}, nodes: {},
    } as never)).rejects.toMatchObject({ code: 'SCRIPT_REJECTED' });
    await expect(executeIsolatedScript('transform', 'x'.repeat(18_000), {
      input: {}, prev: {}, nodes: {},
    })).rejects.toMatchObject({ code: 'SCRIPT_LIMIT_EXCEEDED' });
  });

  it('rejects large results rather than serializing unbounded output into execution logs', async () => {
    await expect(executeIsolatedScript('transform', "return { huge: 'a'.repeat(280000) };", {
      input: {}, prev: {}, nodes: {},
    })).rejects.toMatchObject({ code: 'SCRIPT_LIMIT_EXCEEDED' });
  }, 12_000);

  it('preserves typed transform failure diagnostics for missing fields', async () => {
    await expect(executeTransform({ nodeId: 'transform', config: {
      transformCode: "const x = input.fetch.missing; return x.deep.field;",
    }, context: context() })).rejects.toMatchObject({
      diagnostic: expect.objectContaining({
        code: 'TRANSFORM_MISSING_INPUT_FIELD',
        referencedPath: 'input.fetch.missing',
      }),
    } satisfies Partial<TransformExecutionError>);
  }, 12_000);

  it('follows existing fail-false semantics for invalid Condition expressions', async () => {
    const result = await executeCondition({
      nodeId: 'branch', config: { expression: 'missingVariable.call()' }, context: context(),
    });
    expect(result.output).toMatchObject({ result: false, branchTaken: 'false' });
    expect(result.output.evalError).toBeTruthy();
  }, 12_000);
});
