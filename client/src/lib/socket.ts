import { io, type Socket } from 'socket.io-client';
import { createSocketTicket } from './api';

// Vercel proxies REST, but does not host this persistent Socket.IO connection.
// The endpoint is configured at deploy time and authenticates with a one-time
// opaque ticket obtained through the same-origin API, not the browser JWT.
const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';

let socket: Socket | null = null;

/**
 * Returns the singleton Socket.IO client.
 * Creates the connection on first call.
 */
export function getSocket(): Socket {
  if (!socket) {
    socket = io(SOCKET_URL, {
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
