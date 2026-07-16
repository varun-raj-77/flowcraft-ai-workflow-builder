import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';
import { buildUpstreamUrl, getApiOrigin } from '@/lib/server/apiProxy';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('Vercel API proxy', () => {
  it('rejects missing or private production origins instead of falling back to localhost', () => {
    expect(() => getApiOrigin({ NODE_ENV: 'production' })).toThrow('FLOWCRAFT_API_ORIGIN');
    expect(() => getApiOrigin({ NODE_ENV: 'production', FLOWCRAFT_API_ORIGIN: 'http://localhost:3001' })).toThrow('public HTTPS');
    expect(() => getApiOrigin({ VERCEL: '1', FLOWCRAFT_API_ORIGIN: 'https://api.railway.internal' })).toThrow('public HTTPS');
  });

  it('accepts the public Railway origin and forwards path query method body and cookie', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('FLOWCRAFT_API_ORIGIN', 'https://respectful-communication-production.up.railway.app');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: { ok: true } }), {
      status: 201,
      headers: { 'content-type': 'application/json', 'set-cookie': 'token=opaque; Path=/; HttpOnly; Secure; SameSite=Lax' },
    }));
    const request = new Request('https://flowcraft-ai-workflow-builder.vercel.app/api/auth/login?source=web', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: 'token=prior', origin: 'https://flowcraft-ai-workflow-builder.vercel.app' },
      body: JSON.stringify({ email: 'user@example.com', password: 'safe-test-password' }),
    });

    const response = await POST(request, { params: { path: ['auth', 'login'] } });
    const [upstream, options] = fetchMock.mock.calls[0];

    expect(String(upstream)).toBe('https://respectful-communication-production.up.railway.app/api/auth/login?source=web');
    expect(options?.method).toBe('POST');
    expect((options?.headers as Headers).get('cookie')).toBe('token=prior');
    expect((options?.headers as Headers).get('origin')).toBe('https://flowcraft-ai-workflow-builder.vercel.app');
    expect(await new Response(options?.body).text()).toBe(JSON.stringify({ email: 'user@example.com', password: 'safe-test-password' }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ data: { ok: true } });
    expect(response.headers.get('set-cookie')).toContain('token=opaque');
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it('preserves upstream status and JSON response data', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('FLOWCRAFT_API_ORIGIN', 'https://respectful-communication-production.up.railway.app');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED' } }), { status: 401, headers: { 'content-type': 'application/json' } }));

    const response = await POST(new Request('https://app.example/api/ai/generate', { method: 'POST', body: '{}' }), { params: { path: ['ai', 'generate'] } });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: 'UNAUTHORIZED' } });
  });

  it('builds the HTTP proxy target independently from Socket.IO configuration', () => {
    expect(buildUpstreamUrl(['auth', 'me'], 'https://app.example/api/auth/me', new URL('https://api.example'))).toEqual(new URL('https://api.example/api/auth/me'));
  });
});
