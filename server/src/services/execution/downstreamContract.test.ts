import { afterEach, describe, expect, it, vi } from 'vitest';
import { WORKFLOW_GENERATION_SYSTEM_PROMPT } from '../../prompts/workflowGeneration';
import { executeApiCall } from './executors/apiCall.executor';
import { executeCondition } from './executors/condition.executor';
import { executeTransform } from './executors/transform.executor';
import { TransformExecutionError } from './executors/transformDiagnostics';
import { buildExecutionInputs, resolveTemplates, type ExecutionContext } from './templateEngine';

const contextWithApiResult = (): ExecutionContext => new Map([
  ['node_1', {
    status: 200,
    data: [
      { id: 1, state: 'open', labels: [{ name: 'bug' }] },
      { id: 2, state: 'closed', labels: [] },
    ],
    headers: { 'content-type': 'application/json', 'x-rate-limit-remaining': '4999' },
  }],
]);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('downstream execution contract', () => {
  it('keeps API payload data and response metadata in one predictable wrapper', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify([{ id: 1 }]),
      { status: 200, headers: { 'content-type': 'application/json', 'x-request-id': 'request-1' } },
    )));

    const result = await executeApiCall({
      nodeId: 'node_1',
      config: { url: 'https://api.example.test/issues', method: 'GET' },
      context: new Map(),
    });

    expect(result.output).toEqual({
      status: 200,
      data: [{ id: 1 }],
      headers: expect.objectContaining({ 'content-type': 'application/json', 'x-request-id': 'request-1' }),
    });
  });

  it('builds the same input, prev, and nodes view without unwrapping API results', () => {
    const context = contextWithApiResult();
    context.set('node_2', { high: [{ id: 1 }], low: [] });

    const executionInputs = buildExecutionInputs(context);

    expect(executionInputs.input.node_1).toBe(context.get('node_1'));
    expect(executionInputs.input.node_1.data).toHaveLength(2);
    expect(executionInputs.prev).toBe(context.get('node_2'));
    expect(executionInputs.nodes).toBe(executionInputs.input);
    expect(resolveTemplates('{{node_1.data.0.state}}', context)).toBe('open');
  });

  it('runs guarded transforms against API data and returns an actionable type error otherwise', async () => {
    const safeResult = await executeTransform({
      nodeId: 'node_2',
      config: {
        transformCode: 'const issues = input.node_1?.data; if (!Array.isArray(issues)) throw new Error(\'Expected an array from "Fetch GitHub Issues".\'); const grouped = { high: [], other: [] }; issues.filter((issue) => issue.state === "open").forEach((issue) => grouped.high.push(issue)); return grouped;',
      },
      context: contextWithApiResult(),
    });
    expect(safeResult.output).toEqual({
      high: [{ id: 1, state: 'open', labels: [{ name: 'bug' }] }],
      other: [],
    });

    await expect(executeTransform({
      nodeId: 'node_2',
      config: {
        transformCode: 'const issues = input.node_1; issues.forEach(() => {}); return issues;',
      },
      context: contextWithApiResult(),
    })).rejects.toMatchObject({
      diagnostic: expect.objectContaining({ originalError: 'issues.forEach is not a function' }),
    } satisfies Partial<TransformExecutionError>);
  });

  it('diagnoses the GitHub Issues 401 object response without retaining credentials', async () => {
    const generatedTransform = [
      'const issues = input.node_1?.data;',
      'if (!Array.isArray(issues)) {',
      '  throw new Error(\'Expected an array from "Fetch GitHub Issues".\');',
      '}',
      'const grouped = { high: [], medium: [], low: [] };',
      'issues.forEach((issue) => grouped.low.push(issue));',
      'return grouped;',
    ].join('\n');
    const context: ExecutionContext = new Map([
      ['node_1', {
        status: 401,
        data: {
          message: 'Requires authentication',
          documentation_url: 'https://docs.github.com/rest/issues/issues#list-issues-assigned-to-the-authenticated-user',
          status: '401',
        },
        headers: {
          'content-type': 'application/json; charset=utf-8',
          authorization: 'Bearer github-secret',
          'set-cookie': 'session=hidden',
        },
      }],
    ]);

    let diagnostic: TransformExecutionError['diagnostic'] | undefined;
    try {
      await executeTransform({ nodeId: 'node_2', config: { transformCode: generatedTransform }, context });
    } catch (error) {
      expect(error).toBeInstanceOf(TransformExecutionError);
      diagnostic = (error as TransformExecutionError).diagnostic;
    }

    expect(diagnostic).toMatchObject({
      code: 'TRANSFORM_INPUT_TYPE_MISMATCH',
      message: 'Transform expected an array, but input.node_1.data contained object (HTTP 401).',
      originalError: 'Expected an array from "Fetch GitHub Issues".',
      transformSource: generatedTransform,
      failingLine: 3,
      referencedPath: 'input.node_1.data',
      runtimeContext: {
        input: {
          node_1: {
            status: 401,
            data: expect.objectContaining({ message: 'Requires authentication', status: '401' }),
            headers: { 'content-type': 'application/json; charset=utf-8' },
          },
        },
        prev: expect.objectContaining({ status: 401 }),
      },
    });
    expect(diagnostic?.originalStack).toContain('flowcraft-transform.js');
    expect(JSON.stringify(diagnostic)).not.toContain('github-secret');
    expect(JSON.stringify(diagnostic)).not.toContain('session=hidden');
    expect(JSON.stringify(diagnostic)).not.toContain('authorization');
    expect(JSON.stringify(diagnostic)).not.toContain('set-cookie');
  });

  it('lets conditions inspect prior results through input while preserving templates', async () => {
    const context = contextWithApiResult();
    context.set('node_2', { high: [{ id: 1 }], low: [] });

    const objectValuesResult = await executeCondition({
      nodeId: 'node_3',
      config: { expression: 'Object.values(input.node_2).some((items) => Array.isArray(items) && items.length > 0)' },
      context,
    });
    expect(objectValuesResult.output).toMatchObject({ result: true, branchTaken: 'true' });

    const templateResult = await executeCondition({
      nodeId: 'node_3',
      config: { expression: '{{node_1.status}} === 200' },
      context,
    });
    expect(templateResult.output).toMatchObject({ result: true, branchTaken: 'true' });
  });

  it('documents array guards and excludes sensitive values from generated errors', () => {
    expect(WORKFLOW_GENERATION_SYSTEM_PROMPT).toContain('API Call results are always { status, data, headers }');
    expect(WORKFLOW_GENERATION_SYSTEM_PROMPT).toContain('Array.isArray');
    expect(WORKFLOW_GENERATION_SYSTEM_PROMPT).toContain('Never include payload values, headers, credentials, or tokens in that error');
    expect(WORKFLOW_GENERATION_SYSTEM_PROMPT).not.toContain('authorization:');
  });
});
