import { Server as SocketServer } from 'socket.io';
import type { Server as HttpServer } from 'http';
import { env } from './environment';
import { consumeSocketTicket } from '../services/socketTicket.service';
import { ExecutionRun } from '../models/ExecutionRun.model';

let io: SocketServer | null = null;

/**
 * Creates and attaches Socket.IO to the HTTP server.
 * Must be called once during server startup.
 */
export function initializeSocket(httpServer: HttpServer): SocketServer {
  io = new SocketServer(httpServer, {
    cors: {
      // Match the API's allowlist so configured Vercel preview origins can
      // establish the separate public Socket.IO connection as well.
      origin: env.TRUSTED_ORIGINS,
      credentials: false,
    },
  });

  io.use(async (socket, next) => {
    const ticket = socket.handshake.auth?.ticket;
    if (typeof ticket !== 'string' || ticket.length === 0) {
      console.warn(JSON.stringify({ event: 'socket_auth_failed', reason: 'missing_ticket' }));
      next(new Error('Unauthorized socket connection'));
      return;
    }

    try {
      const userId = await consumeSocketTicket(ticket);
      if (!userId) {
        console.warn(JSON.stringify({ event: 'socket_auth_failed', reason: 'invalid_ticket' }));
        next(new Error('Unauthorized socket connection'));
        return;
      }
      socket.data.userId = userId;
      next();
    } catch {
      console.warn(JSON.stringify({ event: 'socket_auth_failed', reason: 'ticket_lookup_failed' }));
      next(new Error('Unauthorized socket connection'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`[socket] Client connected: ${socket.id}`);

    // Clients join a room for a specific execution run
    socket.on('join:execution', async (runId: string) => {
      const userId = socket.data.userId as string | undefined;
      if (!userId || !(await canJoinExecution(runId, userId))) {
        console.warn(JSON.stringify({
          event: 'socket_execution_join_rejected',
          socketId: socket.id,
          runId,
        }));
        socket.emit('execution:error', {
          runId,
          code: 'UNAUTHORIZED_EXECUTION',
          message: 'You are not allowed to view this execution.',
        });
        return;
      }
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

async function canJoinExecution(runId: string, userId: string): Promise<boolean> {
  try {
    return Boolean(await ExecutionRun.exists({ _id: runId, userId }));
  } catch {
    return false;
  }
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
