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

// GET    /api/executions/run/:runId           → Get a specific execution result
router.get(
  '/run/:runId',
  controller.getExecution,
);

// GET    /api/executions/workflow/:workflowId → List executions for a workflow
router.get(
  '/workflow/:workflowId',
  controller.listExecutions,
);

export default router;
