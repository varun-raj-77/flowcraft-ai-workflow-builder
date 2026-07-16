import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from './route';
import { buildUpstreamUrl, createUpstreamRequestHeaders, getApiOrigin } from '@/lib/server/apiProxy';

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

  it('proxies GET health successfully to the exact public Railway URL', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('FLOWCRAFT_API_ORIGIN', 'https://respectful-communication-production.up.railway.app');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ status: 'ok' }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const response = await GET(new Request('https://flowcraft-ai-workflow-builder.vercel.app/api/health'), { params: { path: ['health'] } });

    expect(String(fetchMock.mock.calls[0][0])).toBe('https://respectful-communication-production.up.railway.app/api/health');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('forwards POST JSON bodies, query strings, cookies, and Set-Cookie responses', async () => {
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
    expect((options as { duplex?: string }).duplex).toBe('half');
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

    const response = await GET(new Request('https://app.example/api/auth/me'), { params: { path: ['auth', 'me'] } });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: 'UNAUTHORIZED' } });
  });

  it('preserves upstream 500 responses instead of mapping them as network failures', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('FLOWCRAFT_API_ORIGIN', 'https://respectful-communication-production.up.railway.app');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: { code: 'INTERNAL_ERROR' } }), { status: 500, headers: { 'content-type': 'application/json' } }));

    const response = await POST(new Request('https://app.example/api/auth/login', { method: 'POST', body: '{}' }), { params: { path: ['auth', 'login'] } });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: 'INTERNAL_ERROR' } });
  });

  it('maps actual network failures to API_UPSTREAM_UNAVAILABLE and logs safe diagnostics', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('FLOWCRAFT_API_ORIGIN', 'https://respectful-communication-production.up.railway.app');
    const error = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(error);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await GET(new Request('https://app.example/api/auth/me?token=never-log', { headers: { 'x-request-id': 'request-123' } }), { params: { path: ['auth', 'me'] } });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: { code: 'API_UPSTREAM_UNAVAILABLE', message: 'API service is temporarily unavailable.' } });
    expect(response.headers.get('x-request-id')).toBe('request-123');
    expect(log).toHaveBeenCalledWith(expect.stringContaining('"errorCauseCode":"ECONNRESET"'));
    expect(log).toHaveBeenCalledWith(expect.not.stringContaining('never-log'));
  });

  it('does not forward hop-by-hop or destination-specific request headers', () => {
    const headers = createUpstreamRequestHeaders(new Headers({
      accept: 'application/json',
      host: 'flowcraft-ai-workflow-builder.vercel.app',
      connection: 'keep-alive',
      'content-length': '99',
      'transfer-encoding': 'chunked',
      'keep-alive': 'timeout=5',
      upgrade: 'websocket',
      te: 'trailers',
      trailer: 'x-checksum',
      'proxy-authorization': 'secret',
    }));

    expect(headers.get('accept')).toBe('application/json');
    for (const name of ['host', 'connection', 'content-length', 'transfer-encoding', 'keep-alive', 'upgrade', 'te', 'trailer', 'proxy-authorization']) {
      expect(headers.get(name)).toBeNull();
    }
  });

  it('builds the HTTP proxy target independently from Socket.IO configuration', () => {
    expect(buildUpstreamUrl(['auth', 'me'], 'https://app.example/api/auth/me', new URL('https://api.example'))).toEqual(new URL('https://api.example/api/auth/me'));
  });
});
