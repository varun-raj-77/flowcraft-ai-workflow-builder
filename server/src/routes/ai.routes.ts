import { Router } from 'express';
import * as controller from '../controllers/ai.controller';
import { validateBody } from '../middleware/validate.middleware';
import { generateWorkflowSchema } from '../validators/ai.validator';

const router = Router();

// POST /api/ai/generate → Generate a workflow from a natural language prompt
router.post(
  '/generate',
  validateBody(generateWorkflowSchema),
  controller.generateWorkflow,
);

export default router;
