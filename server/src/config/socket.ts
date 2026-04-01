import { Server as SocketServer } from 'socket.io';
import type { Server as HttpServer } from 'http';
import { env } from './environment';

let io: SocketServer | null = null;

/**
 * Creates and attaches Socket.IO to the HTTP server.
 * Must be called once during server startup.
 */
export function initializeSocket(httpServer: HttpServer): SocketServer {
  io = new SocketServer(httpServer, {
    cors: {
      origin: env.CLIENT_URL,
      credentials: true,
    },
  });

  io.on('connection', (socket) => {
    console.log(`[socket] Client connected: ${socket.id}`);

    // Clients join a room for a specific execution run
    socket.on('join:execution', (runId: string) => {
      socket.join(`execution:${runId}`);
      console.log(`[socket] ${socket.id} joined execution:${runId}`);
    });

    socket.on('leave:execution', (runId: string) => {
      socket.leave(`execution:${runId}`);
    });

    socket.on('disconnect', () => {
      console.log(`[socket] Client disconnected: ${socket.id}`);
    });
  });

  console.log('[socket] Socket.IO initialized');
  return io;
}

/**
 * Returns the Socket.IO server instance.
 * Throws if called before initializeSocket().
 */
export function getIO(): SocketServer {
  if (!io) {
    throw new Error('Socket.IO not initialized — call initializeSocket() first');
  }
  return io;
}
