import type { Page, Route } from '@playwright/test';

interface MockApiOptions {
  authenticated?: boolean;
  workflows?: Array<Record<string, unknown>>;
}

const now = '2026-07-23T12:00:00.000Z';

export function executableWorkflow(id = 'workflow-ready') {
  return {
    _id: id,
    userId: 'user-e2e',
    name: 'Release summary',
    description: 'A deterministic workflow used only by browser tests.',
    nodes: [
      { id: 'start', type: 'start', label: 'Start', position: { x: 0, y: 0 }, config: {} },
      {
        id: 'output',
        type: 'output',
        label: 'Output Summary',
        position: { x: 240, y: 0 },
        config: { logLevel: 'info', message: 'Browser test complete' },
      },
      { id: 'end', type: 'end', label: 'End', position: { x: 480, y: 0 }, config: {} },
    ],
    edges: [
      { id: 'start-output', source: 'start', target: 'output' },
      { id: 'output-end', source: 'output', target: 'end' },
    ],
    isGeneratedByAI: false,
    createdAt: now,
    updatedAt: now,
  };
}

function summary(workflow: Record<string, unknown>) {
  const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
  const { edges: _edges, nodes: _nodes, ...rest } = workflow;
  return {
    ...rest,
    nodeCount: nodes.length,
    lastExecutionStatus: null,
  };
}

function json(route: Route, status: number, body: unknown) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

export async function installMockApi(page: Page, options: MockApiOptions = {}) {
  let authenticated = options.authenticated ?? true;
  const workflows = new Map<string, Record<string, unknown>>(
    (options.workflows ?? []).map((workflow) => [String(workflow._id), workflow]),
  );

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, '');
    const method = request.method();

    if (path === '/auth/me' && method === 'GET') {
      if (!authenticated) {
        await json(route, 401, { error: { code: 'MISSING_TOKEN', message: 'Authentication required' } });
        return;
      }
      await json(route, 200, {
        data: {
          _id: 'user-e2e',
          email: 'engineer@example.com',
          displayName: 'FlowCraft Engineer',
          isDemoAccount: false,
        },
      });
      return;
    }

    if (path === '/auth/login' && method === 'POST') {
      const credentials = request.postDataJSON() as { email?: string; password?: string };
      if (credentials.email !== 'engineer@example.com' || credentials.password !== 'correct-password') {
        await json(route, 401, { error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } });
        return;
      }
      authenticated = true;
      await json(route, 200, {
        data: { _id: 'user-e2e', email: credentials.email, displayName: 'FlowCraft Engineer' },
      });
      return;
    }

    if (path === '/auth/socket-ticket' && method === 'POST') {
      await json(route, 200, { data: { ticket: 'opaque-e2e-ticket' } });
      return;
    }

    if (path === '/workflows' && method === 'GET') {
      await json(route, 200, { data: [...workflows.values()].map(summary) });
      return;
    }

    if (path === '/workflows' && method === 'POST') {
      const payload = request.postDataJSON() as Record<string, unknown>;
      const id = `workflow-${workflows.size + 1}`;
      const workflow = {
        ...payload,
        _id: id,
        userId: 'user-e2e',
        nodes: payload.nodes ?? [],
        edges: payload.edges ?? [],
        isGeneratedByAI: payload.isGeneratedByAI ?? false,
        createdAt: now,
        updatedAt: now,
      };
      workflows.set(id, workflow);
      await json(route, 201, { data: workflow });
      return;
    }

    const workflowMatch = path.match(/^\/workflows\/([^/]+)$/);
    if (workflowMatch) {
      const id = workflowMatch[1];
      if (method === 'GET') {
        const workflow = workflows.get(id);
        await json(
          route,
          workflow ? 200 : 404,
          workflow ? { data: workflow } : { error: { code: 'NOT_FOUND', message: 'Workflow not found' } },
        );
        return;
      }
      if (method === 'PUT') {
        const current = workflows.get(id) ?? {};
        const workflow = { ...current, ...(request.postDataJSON() as Record<string, unknown>), updatedAt: now };
        workflows.set(id, workflow);
        await json(route, 200, { data: workflow });
        return;
      }
      if (method === 'DELETE') {
        workflows.delete(id);
        await route.fulfill({ status: 204, body: '' });
        return;
      }
    }

    if (path === '/ai/generate' && method === 'POST') {
      const { prompt } = request.postDataJSON() as { prompt: string };
      await json(route, 200, {
        data: {
          name: 'AI Release Digest',
          description: 'Generated against a deterministic browser-test response.',
          nodes: executableWorkflow('generated').nodes,
          edges: executableWorkflow('generated').edges,
          generationMetadata: {
            originalPrompt: prompt,
            generatedAt: now,
            provider: 'mock',
            model: 'mock-flowcraft',
            capabilityCoverage: {
              requestedCapabilities: ['output'],
              implementedCapabilities: ['output'],
              missingCapabilities: [],
              unsupportedCapabilities: [],
              coverage: 1,
              isComplete: true,
            },
          },
        },
      });
      return;
    }

    const runMatch = path.match(/^\/executions\/([^/]+)\/run$/);
    if (runMatch && method === 'POST') {
      const workflowId = runMatch[1];
      await json(route, 200, {
        data: {
          _id: 'run-e2e',
          workflowId,
          userId: 'user-e2e',
          status: 'completed',
          startedAt: now,
          completedAt: now,
          triggerType: 'manual',
          stepLogs: [
            { nodeId: 'start', nodeType: 'start', nodeLabel: 'Start', status: 'success', durationMs: 1 },
            {
              nodeId: 'output',
              nodeType: 'output',
              nodeLabel: 'Output Summary',
              status: 'success',
              durationMs: 2,
              output: { message: 'Browser test complete' },
            },
            { nodeId: 'end', nodeType: 'end', nodeLabel: 'End', status: 'success', durationMs: 1 },
          ],
          executionOrder: ['start', 'output', 'end'],
          createdAt: now,
          updatedAt: now,
        },
      });
      return;
    }

    await json(route, 404, {
      error: { code: 'UNMOCKED_E2E_REQUEST', message: `${method} ${path} is not mocked` },
    });
  });

  return { workflows };
}
