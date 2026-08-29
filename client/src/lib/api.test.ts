import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  changePassword,
  getMe,
  getWorkflowAiPromptContext,
  getWorkflowRevision,
  listWorkflowRevisions,
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
