import { NextResponse } from 'next/server';
import {
  buildUpstreamUrl,
  createProxyResponseHeaders,
  createUpstreamRequestHeaders,
} from '@/lib/server/apiProxy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type RouteContext = { params: { path: string[] } };

async function proxy(request: Request, { params }: RouteContext): Promise<Response> {
  try {
    const upstream = await fetch(buildUpstreamUrl(params.path, request.url), {
      method: request.method,
      headers: createUpstreamRequestHeaders(request.headers),
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
      cache: 'no-store',
    });

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: createProxyResponseHeaders(upstream.headers),
    });
  } catch (error) {
    const isConfigurationError = error instanceof Error && error.message.startsWith('FLOWCRAFT_API_ORIGIN');
    if (isConfigurationError) console.error('[api-proxy] configuration error:', error.message);
    else console.error('[api-proxy] upstream request failed');

    return NextResponse.json(
      { error: { code: isConfigurationError ? 'API_PROXY_MISCONFIGURED' : 'API_UPSTREAM_UNAVAILABLE', message: isConfigurationError ? 'API proxy is not configured.' : 'API service is temporarily unavailable.' } },
      { status: isConfigurationError ? 500 : 502, headers: { 'cache-control': 'private, no-store, max-age=0' } },
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
