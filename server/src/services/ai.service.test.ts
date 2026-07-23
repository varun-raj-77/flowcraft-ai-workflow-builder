import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockedEnvironment = vi.hoisted(() => ({
  env: { ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_MODEL: 'workspace-selected-model' },
}));

vi.mock('../config/environment', () => mockedEnvironment);

import { generateWorkflow } from './ai.service';

afterEach(() => vi.unstubAllGlobals());

beforeEach(() => {
  mockedEnvironment.env.ANTHROPIC_MODEL = 'workspace-selected-model';
});

describe('Anthropic workflow generation', () => {
  it('uses the configured model and preserves the generated workflow schema', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      content: [{ type: 'text', text: JSON.stringify({
        name: 'Generated workflow',
        nodes: [
          { id: 'node_0', type: 'start', label: 'Start', position: { x: 0, y: 0 }, config: {} },
          { id: 'node_1', type: 'end', label: 'End', position: { x: 280, y: 0 }, config: {} },
        ],
        edges: [{ id: 'edge_0', source: 'node_0', target: 'node_1' }],
      }) }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const workflow = await generateWorkflow('Create a workflow');

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      model: mockedEnvironment.env.ANTHROPIC_MODEL,
      max_tokens: 4096,
      messages: [{ role: 'user', content: 'Create a workflow' }],
    });
    expect(workflow).toMatchObject({
      name: 'Generated workflow',
      nodes: expect.any(Array),
      edges: expect.any(Array),
      generationMetadata: { model: mockedEnvironment.env.ANTHROPIC_MODEL },
    });
  });

  it('rejects assigned-to-me GitHub intent before calling the provider', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateWorkflow(
      'Build a workflow that fetches GitHub issues, filters open bugs assigned to me, groups them by priority, and generates a summary.',
    )).rejects.toMatchObject({
      statusCode: 422,
      code: 'AI_AUTHENTICATION_REQUIRED',
      message: expect.stringContaining('requires GitHub authentication'),
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('allows a generated public GitHub repository endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      content: [{ type: 'text', text: JSON.stringify({
        name: 'Public React Issues',
        nodes: [
          { id: 'node_0', type: 'start', label: 'Start', position: { x: 0, y: 0 }, config: {} },
          { id: 'node_1', type: 'api_call', label: 'Fetch React Issues', position: { x: 280, y: 0 }, config: { url: 'https://api.github.com/repos/facebook/react/issues?state=open', method: 'GET', headers: { Accept: 'application/vnd.github+json' } } },
          { id: 'node_2', type: 'end', label: 'End', position: { x: 560, y: 0 }, config: {} },
        ],
        edges: [
          { id: 'edge_0', source: 'node_0', target: 'node_1' },
          { id: 'edge_1', source: 'node_1', target: 'node_2' },
        ],
      }) }],
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const workflow = await generateWorkflow('Fetch public GitHub issues from facebook/react');

    expect(workflow.nodes[1].config.url).toBe('https://api.github.com/repos/facebook/react/issues?state=open');
    expect(workflow.nodes[1].config.headers).not.toHaveProperty('Authorization');
  });
});
