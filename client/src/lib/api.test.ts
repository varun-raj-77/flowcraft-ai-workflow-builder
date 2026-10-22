import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  getExecution,
  changePassword,
  getMe,
  getWorkflowAiPromptContext,
  getWorkflowRevision,
  listWorkflowRevisions,
  listExecutionHistoryPage,
  regenerateWorkflow,
  restoreWorkflowRevision,
  updateWorkflow,
} from './api';

describe('shared API client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses the first-party API path with credentials and no-store caching', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ data: { _id: 'user-1', email: 'user@example.com', displayName: 'User' } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    await getMe();

    expect(fetchMock).toHaveBeenCalledWith('/api/auth/me', expect.objectContaining({
      credentials: 'include',
      cache: 'no-store',
    }));
  });

  it('preserves the server error code for authenticated UI handling', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: { code: 'MISSING_TOKEN', message: 'Authentication required' } }),
      { status: 401, headers: { 'content-type': 'application/json' } },
    )));

    await expect(getMe()).rejects.toEqual(new ApiError(401, 'MISSING_TOKEN', 'Authentication required'));
  });

  it('changes the current user password through the authenticated same-origin endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ data: { success: true, message: 'Password changed successfully.' } }),
      { status: 200 },
    ));
    vi.stubGlobal('fetch', fetchMock);

    await changePassword({ currentPassword: 'current-password', newPassword: 'new-password' });

    expect(fetchMock).toHaveBeenCalledWith('/api/auth/change-password', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify({ currentPassword: 'current-password', newPassword: 'new-password' }),
    }));
  });

  it('sends the expected revision with workflow updates for stale-save protection', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ data: { _id: 'workflow-1', currentRevision: 4 } }),
      { status: 200 },
    ));
    vi.stubGlobal('fetch', fetchMock);

    await updateWorkflow('workflow-1', { expectedRevision: 3, name: 'Updated' });

    expect(fetchMock).toHaveBeenCalledWith('/api/workflows/workflow-1', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ expectedRevision: 3, name: 'Updated' }),
    }));
  });

  it('uses revision-number cursors for history and exact revision retrieval', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { revisions: [], nextBeforeRevision: null } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { workflowId: 'workflow-1', revision: 7 } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await listWorkflowRevisions('workflow-1', { limit: 20, beforeRevision: 15 });
    await getWorkflowRevision('workflow-1', 7);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/workflows/workflow-1/revisions?limit=20&beforeRevision=15',
      expect.objectContaining({ credentials: 'include', cache: 'no-store' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/workflows/workflow-1/revisions/7',
      expect.objectContaining({ credentials: 'include', cache: 'no-store' }),
    );
  });

  it('requests bounded execution pages with encoded cursors and first-party credentials', async () => {
    const request = vi.fn().mockImplementation(async () => new Response(
      JSON.stringify({ data: { runs: [], nextCursor: null } }), { status: 200 },
    ));
    vi.stubGlobal('fetch', request);
    expect(await listExecutionHistoryPage('workflow-1', 'opaque+/token')).toEqual({ runs: [], nextCursor: null });
    expect(request).toHaveBeenCalledWith(
      '/api/executions/workflow/workflow-1/page?cursor=opaque%2B%2Ftoken&view=summary',
      expect.objectContaining({ credentials: 'include', cache: 'no-store' }),
    );
    await listExecutionHistoryPage('workflow-1');
    expect(request).toHaveBeenLastCalledWith(
      '/api/executions/workflow/workflow-1/page?view=summary', expect.any(Object),
    );
    await listExecutionHistoryPage('workflow-1', 'v2cursor', 'failed');
    expect(request).toHaveBeenLastCalledWith(
      '/api/executions/workflow/workflow-1/page?cursor=v2cursor&status=failed&view=summary',
      expect.objectContaining({ credentials: 'include', cache: 'no-store' }),
    );
  });

  it('drops full payloads returned by an older backend that ignores view=summary', async () => {
    const fullRun = {
      _id: 'run-1', workflowId: 'workflow-1', userId: 'user-1',
      status: 'failed', startedAt: '2026-10-20T10:00:00.000Z',
      triggerType: 'manual', createdAt: '2026-10-20T10:00:00.000Z',
      updatedAt: '2026-10-20T10:00:01.000Z', executionOrder: ['node-1'],
      error: 'root-secret-CANARY',
      extraFutureField: 'future-secret-CANARY',
      stepLogs: [{ nodeId: 'node-1', nodeType: 'api_call', nodeLabel: 'API',
        status: 'failed', durationMs: 50, error: 'step-secret-CANARY',
        input: { token: 'input-secret-CANARY' }, output: { token: 'output-secret-CANARY' },
        diagnostic: { secret: 'diagnostic-CANARY' }, futureField: 'step-future-CANARY' }],
    };
    const request = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ data: { runs: [fullRun], nextCursor: 'older-cursor' } }), { status: 200 },
    ));
    vi.stubGlobal('fetch', request);
    const page = await listExecutionHistoryPage('workflow-1');
    expect(page.nextCursor).toBe('older-cursor');
    expect(page.runs[0].stepLogs).toEqual([{ nodeId: 'node-1', nodeType: 'api_call',
      nodeLabel: 'API', status: 'failed', durationMs: 50 }]);
    expect(JSON.stringify(page)).not.toMatch(/CANARY|extraFutureField|diagnostic|error|input|output/);
    expect(request).toHaveBeenCalledWith(
      '/api/executions/workflow/workflow-1/page?view=summary',
      expect.objectContaining({ credentials: 'include', cache: 'no-store' }),
    );
  });

  it('rejects malformed, oversized and cross-workflow history pages without storing rows', async () => {
    const validRun = {
      _id: 'run-1', workflowId: 'workflow-1', userId: 'user-1',
      status: 'completed', startedAt: '2026-10-20T10:00:00Z', triggerType: 'manual',
      createdAt: '2026-10-20T10:00:00Z', updatedAt: '2026-10-20T10:00:00Z',
      executionOrder: [], stepLogs: [],
    };
    const invalidPages = [
      undefined,
      { runs: 'not-an-array', nextCursor: null },
      { runs: [validRun], nextCursor: { $gt: '' } },
      { runs: [{ ...validRun, workflowId: 'another-workflow' }], nextCursor: null },
      { runs: [{ ...validRun, stepLogs: null }], nextCursor: null },
      { runs: Array.from({ length: 21 }, () => validRun), nextCursor: null },
    ];
    const fetchMock = vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({ data: invalidPages.shift() }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    for (let i = 0; i < 6; i++) {
      await expect(listExecutionHistoryPage('workflow-1')).rejects.toMatchObject({
        code: 'INVALID_HISTORY_RESPONSE',
      });
    }
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it('forwards an AbortSignal to the same-origin history request without changing existing query semantics', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ data: { runs: [], nextCursor: null } }), { status: 200 },
    ));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    await listExecutionHistoryPage('workflow-1', null, 'failed', controller.signal);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/executions/workflow/workflow-1/page?status=failed&view=summary',
      expect.objectContaining({
        signal: controller.signal,
        credentials: 'include',
        cache: 'no-store',
      }),
    );
    controller.abort();
    expect(controller.signal.aborted).toBe(true);
  });

  it('requests full details for a single run with an optional cancellation signal', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ data: { _id: 'run-123', stepLogs: [] } }), { status: 200 },
    ));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    await getExecution('run-123', controller.signal);
    expect(fetchMock).toHaveBeenCalledWith('/api/executions/run/run-123',
      expect.objectContaining({ signal: controller.signal, credentials: 'include', cache: 'no-store' }));
  });

  it('sends expectedRevision when restoring a historical revision as new', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ data: { _id: 'workflow-1', currentRevision: 9 } }),
      { status: 201 },
    ));
    vi.stubGlobal('fetch', fetchMock);

    await restoreWorkflowRevision('workflow-1', 3, { expectedRevision: 8 });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workflows/workflow-1/revisions/3/restore',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ expectedRevision: 8 }),
      }),
    );
  });

  it('loads backend prompt lineage and ties regeneration to the starting revision', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { status: 'available', prompt: 'Prompt P1', promptRevision: 1, currentRevision: 1, relationship: 'direct' },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { _id: 'workflow-1', currentRevision: 2 } }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    await getWorkflowAiPromptContext('workflow-1');
    await regenerateWorkflow('workflow-1', { prompt: 'Prompt P2', expectedRevision: 1 });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/workflows/workflow-1/ai-prompt-context',
      expect.objectContaining({ credentials: 'include', cache: 'no-store' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/ai/workflows/workflow-1/regenerate',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ prompt: 'Prompt P2', expectedRevision: 1 }),
      }),
    );
  });
});
