import { io, type Socket } from 'socket.io-client';
import { createSocketTicket } from './api';

const LOCAL_SOCKET_URL = 'http://localhost:3001';
const CLIENT_SOCKET_ENV = {
  // NEXT_PUBLIC_* values must be referenced directly so Next.js inlines them
  // into the browser bundle during the deployment build.
  NODE_ENV: process.env.NODE_ENV,
  VERCEL: process.env.VERCEL,
  NEXT_PUBLIC_SOCKET_URL: process.env.NEXT_PUBLIC_SOCKET_URL,
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
};

type SocketEnvironment = Readonly<Partial<Pick<NodeJS.ProcessEnv, 'NODE_ENV' | 'VERCEL' | 'NEXT_PUBLIC_SOCKET_URL' | 'NEXT_PUBLIC_API_URL'>>>;
export type SocketUrlSource = 'socket-url' | 'api-url' | 'development';

export interface SocketUrlResolution {
  origin: string;
  source: SocketUrlSource;
  runtime: string;
}

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

function resolveOrigin(value: string, variableName: string, production: boolean, allowPath: boolean): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${variableName} must be an absolute HTTP(S) URL.`);
  }

  if (!['http:', 'https:'].includes(url.protocol) || url.search || url.hash) {
    throw new Error(`${variableName} must be an absolute HTTP(S) origin without a query or fragment.`);
  }
  if (!allowPath && url.pathname !== '/' && url.pathname !== '/socket.io' && url.pathname !== '/socket.io/') {
    throw new Error(`${variableName} must be an origin; the Socket.IO path is configured by the client.`);
  }
  if (production && (url.protocol !== 'https:' || isPrivateHostname(url.hostname))) {
    throw new Error(`${variableName} must use a public HTTPS hostname in production.`);
  }

  return url.origin;
}

// Vercel proxies REST, but does not host this persistent Socket.IO connection.
// The endpoint is configured at deploy time and authenticates with a one-time
// opaque ticket obtained through the same-origin API, not the browser JWT.
export function resolveSocketUrl(environment: SocketEnvironment = CLIENT_SOCKET_ENV): SocketUrlResolution {
  const configuredUrl = environment.NEXT_PUBLIC_SOCKET_URL?.trim();
  const production = environment.NODE_ENV !== 'development' || environment.VERCEL === '1';
  const runtime = environment.NODE_ENV ?? 'unknown';

  if (configuredUrl) {
    return { origin: resolveOrigin(configuredUrl, 'NEXT_PUBLIC_SOCKET_URL', production, false), source: 'socket-url', runtime };
  }

  const configuredApiUrl = environment.NEXT_PUBLIC_API_URL?.trim();
  if (configuredApiUrl) {
    return { origin: resolveOrigin(configuredApiUrl, 'NEXT_PUBLIC_API_URL', production, true), source: 'api-url', runtime };
  }

  if (!production) return { origin: LOCAL_SOCKET_URL, source: 'development', runtime };

  // The App Router REST proxy uses fetch and cannot forward Socket.IO's
  // WebSocket upgrade, so a Vercel same-origin fallback is not available.
  throw new Error('Socket.IO is not configured. Set NEXT_PUBLIC_SOCKET_URL or NEXT_PUBLIC_API_URL to a public HTTPS backend origin, then redeploy.');
}

export function getSocketUrl(environment: SocketEnvironment = CLIENT_SOCKET_ENV): string {
  return resolveSocketUrl(environment).origin;
}

let socket: Socket | null = null;

/**
 * Returns the singleton Socket.IO client.
 * Creates the connection on first call.
 */
export function getSocket(): Socket {
  if (!socket) {
    const resolution = resolveSocketUrl();
    if (resolution.runtime === 'development') {
      console.info('[socket] resolved', { source: resolution.source, origin: resolution.origin, runtime: resolution.runtime });
    }
    socket = io(resolution.origin, {
      autoConnect: true,
      withCredentials: false,
      auth: (callback) => {
        void createSocketTicket()
          .then(({ ticket }) => callback({ ticket }))
          .catch(() => callback({}));
      },
    });
  }
  return socket;
}
