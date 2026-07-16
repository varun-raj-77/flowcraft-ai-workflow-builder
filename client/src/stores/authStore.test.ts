import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from './authStore';

const user = { _id: 'user-1', email: 'user@example.com', displayName: 'User' };

describe('authStore session verification', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: false });
  });

  it('authenticates only after register and /auth/me both succeed', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: user }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: user }), { status: 200 })));

    await useAuthStore.getState().register('user@example.com', 'password', 'User');

    expect(useAuthStore.getState()).toMatchObject({ user, isAuthenticated: true, isLoading: false });
  });

  it('clears state and rejects a login when the session cannot be verified', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: user }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'MISSING_TOKEN', message: 'Authentication required' } }), { status: 401 })));

    await expect(useAuthStore.getState().login('user@example.com', 'password'))
      .rejects.toMatchObject({ code: 'SESSION_NOT_ESTABLISHED' });

    expect(useAuthStore.getState()).toMatchObject({ user: null, isAuthenticated: false, isLoading: false });
  });
});
