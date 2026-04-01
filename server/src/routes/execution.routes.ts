import { Router } from 'express';
import * as controller from '../controllers/execution.controller';

const router = Router();

// POST   /api/executions/:workflowId/run     → Trigger a workflow execution
router.post(
  '/:workflowId/run',
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
