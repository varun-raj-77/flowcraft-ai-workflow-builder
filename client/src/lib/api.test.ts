import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, getMe } from './api';

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
});
