import { Router } from 'express';
import * as controller from '../controllers/ai.controller';
import { validateBody } from '../middleware/validate.middleware';
import { generateWorkflowSchema } from '../validators/ai.validator';
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

export default router;
