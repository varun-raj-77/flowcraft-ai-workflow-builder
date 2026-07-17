import { io, type Socket } from 'socket.io-client';
import { createSocketTicket } from './api';

const LOCAL_SOCKET_URL = 'http://localhost:3001';

// Vercel proxies REST, but does not host this persistent Socket.IO connection.
// The endpoint is configured at deploy time and authenticates with a one-time
// opaque ticket obtained through the same-origin API, not the browser JWT.
export function getSocketUrl(environment: NodeJS.ProcessEnv = process.env): string {
  const configuredUrl = environment.NEXT_PUBLIC_SOCKET_URL?.trim();
  // Localhost is an explicit development-only default. Any other runtime must
  // provide the public Socket.IO endpoint instead of silently targeting a
  // developer machine from a production browser.
  const production = environment.NODE_ENV !== 'development' || environment.VERCEL === '1';
  if (!configuredUrl) {
    if (!production) return LOCAL_SOCKET_URL;
    throw new Error('NEXT_PUBLIC_SOCKET_URL must be configured to a public HTTPS Socket.IO origin in production.');
  }

  const url = new URL(configuredUrl);
  const privateHostname = url.hostname === 'localhost'
    || /^127(?:\.\d{1,3}){3}$/.test(url.hostname)
    || url.hostname.endsWith('.internal')
    || url.hostname.endsWith('.local');
  if (production && (url.protocol !== 'https:' || privateHostname)) {
    throw new Error('NEXT_PUBLIC_SOCKET_URL must use a public HTTPS hostname in production.');
  }
  return url.toString().replace(/\/$/, '');
}

let socket: Socket | null = null;

/**
 * Returns the singleton Socket.IO client.
 * Creates the connection on first call.
 */
export function getSocket(): Socket {
  if (!socket) {
    socket = io(getSocketUrl(), {
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
