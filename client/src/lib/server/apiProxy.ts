const LOCAL_API_ORIGIN = 'http://localhost:3001';
const FORWARDED_REQUEST_HEADERS = [
  'accept',
  'authorization',
  'content-type',
  'cookie',
  'origin',
  'referer',
  'user-agent',
  'x-request-id',
] as const;
const FORWARDED_RESPONSE_HEADERS = [
  'content-type',
  'location',
  'pragma',
  'retry-after',
  'x-request-id',
  'ratelimit-limit',
  'ratelimit-remaining',
  'ratelimit-reset',
] as const;
type ProxyEnvironment = Readonly<Record<string, string | undefined>>;

function isPrivateHostname(hostname: string): boolean {
  return hostname === 'localhost'
    || hostname === '::1'
    || /^127(?:\.\d{1,3}){3}$/.test(hostname)
    || /^10(?:\.\d{1,3}){3}$/.test(hostname)
    || /^192\.168(?:\.\d{1,3}){2}$/.test(hostname)
    || /^172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2}$/.test(hostname)
    || hostname.endsWith('.internal')
    || hostname.endsWith('.local');
}

/** Resolves a server-only, public upstream for the Vercel route handler. */
export function getApiOrigin(environment: ProxyEnvironment = process.env): URL {
  const configuredOrigin = environment.FLOWCRAFT_API_ORIGIN?.trim();
  const production = environment.NODE_ENV === 'production' || environment.VERCEL === '1';

  if (!configuredOrigin) {
    if (!production) return new URL(LOCAL_API_ORIGIN);
    throw new Error('FLOWCRAFT_API_ORIGIN must be configured to a public HTTPS API origin in production.');
  }

  let origin: URL;
  try {
    origin = new URL(configuredOrigin);
  } catch {
    throw new Error('FLOWCRAFT_API_ORIGIN must be an absolute HTTP(S) URL.');
  }

  if (!['http:', 'https:'].includes(origin.protocol) || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('FLOWCRAFT_API_ORIGIN must be an origin without a path, query, or fragment.');
  }

  if (production && (origin.protocol !== 'https:' || isPrivateHostname(origin.hostname))) {
    throw new Error('FLOWCRAFT_API_ORIGIN must use a public HTTPS hostname in production.');
  }

  return origin;
}

export function buildUpstreamUrl(path: string[], requestUrl: string, origin = getApiOrigin()): URL {
  const upstream = new URL(`/api/${path.map(encodeURIComponent).join('/')}`, origin);
  upstream.search = new URL(requestUrl).search;
  return upstream;
}

export function createUpstreamRequestHeaders(requestHeaders: Headers): Headers {
  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = requestHeaders.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

export function createProxyResponseHeaders(upstreamHeaders: Headers): Headers {
  const headers = new Headers({ 'cache-control': 'private, no-store, max-age=0' });
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstreamHeaders.get(name);
    if (value) headers.set(name, value);
  }

  const setCookies = typeof (upstreamHeaders as Headers & { getSetCookie?: () => string[] }).getSetCookie === 'function'
    ? (upstreamHeaders as Headers & { getSetCookie: () => string[] }).getSetCookie()
    : upstreamHeaders.get('set-cookie') ? [upstreamHeaders.get('set-cookie')!] : [];
  for (const cookie of setCookies) headers.append('set-cookie', cookie);

  return headers;
}

export function getSafeFetchError(error: unknown): { name: string; message: string; causeCode: string | null } {
  const fetchError = error instanceof Error ? error : new Error('Unknown upstream fetch failure');
  const cause = fetchError.cause as { code?: unknown } | undefined;
  return {
    name: fetchError.name,
    message: fetchError.message.replace(/(https?:\/\/[^\s?]+)\?\S*/g, '$1?[REDACTED]'),
    causeCode: typeof cause?.code === 'string' ? cause.code : null,
  };
}
