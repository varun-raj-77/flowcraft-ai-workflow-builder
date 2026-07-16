import { NextResponse } from 'next/server';
import {
  buildUpstreamUrl,
  createProxyResponseHeaders,
  createUpstreamRequestHeaders,
  getSafeFetchError,
} from '@/lib/server/apiProxy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type RouteContext = { params: { path: string[] } };

async function proxy(request: Request, { params }: RouteContext): Promise<Response> {
  const requestId = request.headers.get('x-request-id') || crypto.randomUUID();
  const path = `/api/${params.path.map(encodeURIComponent).join('/')}`;
  let upstreamUrl: URL | undefined;

  try {
    upstreamUrl = buildUpstreamUrl(params.path, request.url);
    const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body;
    const upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers: createUpstreamRequestHeaders(request.headers),
      body,
      ...(body ? { duplex: 'half' as const } : {}),
      cache: 'no-store',
    } as RequestInit & { duplex?: 'half' });

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: createProxyResponseHeaders(upstream.headers),
    });
  } catch (error) {
    const isConfigurationError = error instanceof Error && error.message.startsWith('FLOWCRAFT_API_ORIGIN');
    const upstreamHostname = upstreamUrl?.hostname ?? null;
    if (isConfigurationError) {
      console.error(JSON.stringify({ event: 'api_proxy_configuration_error', requestId, method: request.method, path, upstreamHostname, errorMessage: error.message }));
    } else {
      const details = getSafeFetchError(error);
      console.error(JSON.stringify({
        event: 'api_proxy_upstream_fetch_failed',
        requestId,
        method: request.method,
        path: upstreamUrl?.pathname ?? path,
        upstreamHostname,
        errorName: details.name,
        errorMessage: details.message,
        errorCauseCode: details.causeCode,
      }));
    }

    return NextResponse.json(
      { error: { code: isConfigurationError ? 'API_PROXY_MISCONFIGURED' : 'API_UPSTREAM_UNAVAILABLE', message: isConfigurationError ? 'API proxy is not configured.' : 'API service is temporarily unavailable.' } },
      { status: isConfigurationError ? 500 : 502, headers: { 'cache-control': 'private, no-store, max-age=0', 'x-request-id': requestId } },
    );
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const HEAD = proxy;
export const OPTIONS = proxy;
