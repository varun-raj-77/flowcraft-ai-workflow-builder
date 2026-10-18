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
import { startExecutionRecoveryMonitor } from './services/execution/executionRecovery';
import { checkRetryReadiness } from './services/execution/executionObservability';

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
    // After MongoDB is connected and API is listening, begin bounded recovery.
    // Recovery only touches expired M9-leased runs; it never reruns a workflow.
    startExecutionRecoveryMonitor();
    // Read-only, private operational signal. Retry endpoint still checks each write.
    void checkRetryReadiness().then((readiness) => {
      console.info(JSON.stringify({ event: 'retry_index_readiness', readiness }));
    });
    console.log(`[server] FlowCraft API running on port ${env.PORT}`);
    console.log(`[server] Environment: ${env.NODE_ENV}`);
    console.log(`[server] Using Anthropic model: ${env.ANTHROPIC_MODEL}`);
    console.log(`[server] Trusted origins configured: ${env.TRUSTED_ORIGINS.length}`);
  });
}

main().catch((err) => {
  console.error('[server] Failed to start:', err);
  process.exit(1);
});
