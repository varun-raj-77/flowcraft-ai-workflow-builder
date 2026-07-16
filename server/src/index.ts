import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/environment';
import { connectDatabase } from './config/database';
import { initializeSocket } from './config/socket';
import routes from './routes';
import { errorHandler } from './middleware/errorHandler.middleware';
import { requestContext } from './middleware/requestContext.middleware';

async function main() {
  const app = express();
  const httpServer = createServer(app);
  app.set('trust proxy', 1);

  // ── Socket.IO ───────────────────────────────────────────
  initializeSocket(httpServer);

  // ── Middleware ───────────────────────────────────────────
  app.use(requestContext);
  app.use(cors({
    origin: env.TRUSTED_ORIGINS,
    credentials: true,
  }));
  app.use(express.json({ limit: '5mb' }));
  app.use(cookieParser());
  app.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    next();
  });

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
    console.log(`[server] Trusted origins configured: ${env.TRUSTED_ORIGINS.length}`);
  });
}

main().catch((err) => {
  console.error('[server] Failed to start:', err);
  process.exit(1);
});
