import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/environment';
import { connectDatabase } from './config/database';
import { initializeSocket } from './config/socket';
import routes from './routes';
import { errorHandler } from './middleware/errorHandler.middleware';

async function main() {
  const app = express();
  const httpServer = createServer(app);

  // ── Socket.IO ───────────────────────────────────────────
  initializeSocket(httpServer);

  // ── Middleware ───────────────────────────────────────────
  app.use(cors({
    origin: env.CLIENT_URL,
    credentials: true,
  }));
  app.use(express.json({ limit: '5mb' }));
  app.use(cookieParser());

  // ── Health check ────────────────────────────────────────
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // ── API routes ──────────────────────────────────────────
  app.use('/api', routes);

  // ── Error handler (must be last) ────────────────────────
  app.use(errorHandler);

  // ── Database + Start ────────────────────────────────────
  await connectDatabase();
  const PORT = Number(env.PORT) || 3001;

  httpServer.listen(PORT, () => {
    console.log(`[server] FlowCraft API running on port ${env.PORT}`);
    console.log(`[server] Environment: ${env.NODE_ENV}`);
    console.log(`[server] CORS origin: ${env.CLIENT_URL}`);
  });
}

main().catch((err) => {
  console.error('[server] Failed to start:', err);
  process.exit(1);
});
