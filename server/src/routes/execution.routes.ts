import { Router } from 'express';
import * as controller from '../controllers/execution.controller';
import { createRateLimiter } from '../middleware/rateLimit.middleware';

const router = Router();
const executionLimiter = createRateLimiter({ name: 'workflow-execute', windowMs: 60 * 1000, max: 30 });

// POST   /api/executions/:workflowId/run     → Trigger a workflow execution
router.post(
  '/:workflowId/run',
  executionLimiter,
  controller.runWorkflow,
);

// POST   /api/executions/:workflowId/simulate → Mock-only, pinned, read-only test run
router.post(
  '/:workflowId/simulate',
  executionLimiter,
  controller.simulateWorkflow,
);

// POST /api/executions/run/:runId/retry → User-confirmed new attempt, idempotent by source run
router.post(
  '/run/:runId/retry',
  executionLimiter,
  controller.retryExecution,
);

// GET    /api/executions/run/:runId           → Get a specific execution result
router.get(
  '/run/:runId/provenance',
  controller.getExecutionRevisionProvenance,
);

router.get(
  '/run/:runId',
  controller.getExecution,
);

// Auth enforced by /api/executions mount in routes/index.ts.
const diagnosticsLimiter = createRateLimiter({
  name: 'execution-diagnostics', windowMs: 60_000, max: 12,
});
router.get(
  '/workflow/:workflowId/diagnostics',
  diagnosticsLimiter,
  controller.getExecutionDiagnostics,
);

// GET    /api/executions/workflow/:workflowId → List executions for a workflow
router.get(
  '/workflow/:workflowId',
  controller.listExecutions,
);

export default router;
