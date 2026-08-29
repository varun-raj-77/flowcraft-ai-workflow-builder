import { Router } from 'express';
import * as controller from '../controllers/ai.controller';
import { validateBody } from '../middleware/validate.middleware';
import { generateWorkflowSchema, regenerateWorkflowSchema } from '../validators/ai.validator';
import { createRateLimiter } from '../middleware/rateLimit.middleware';

const router = Router();
const aiLimiter = createRateLimiter({ name: 'ai-generate', windowMs: 60 * 1000, max: 20 });

// POST /api/ai/generate → Generate a workflow from a natural language prompt
router.post(
  '/generate',
  aiLimiter,
  validateBody(generateWorkflowSchema),
  controller.generateWorkflow,
);

// POST /api/ai/workflows/:workflowId/regenerate → Generate and atomically persist a new AI revision
router.post(
  '/workflows/:workflowId/regenerate',
  aiLimiter,
  validateBody(regenerateWorkflowSchema),
  controller.regenerateWorkflow,
);

export default router;
