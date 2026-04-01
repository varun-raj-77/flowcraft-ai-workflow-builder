import { Router } from 'express';
import * as controller from '../controllers/workflow.controller';
import { validateBody } from '../middleware/validate.middleware';
import {
  createWorkflowSchema,
  updateWorkflowSchema,
} from '../validators/workflow.validator';

const router = Router();

// POST   /api/workflows          → Create a new workflow
router.post(
  '/',
  validateBody(createWorkflowSchema),
  controller.createWorkflow,
);

// GET    /api/workflows          → List all workflows for the user
router.get(
  '/',
  controller.listWorkflows,
);

// GET    /api/workflows/:id      → Get a single workflow with full graph
router.get(
  '/:id',
  controller.getWorkflow,
);

// PUT    /api/workflows/:id      → Update a workflow
router.put(
  '/:id',
  validateBody(updateWorkflowSchema),
  controller.updateWorkflow,
);

// DELETE /api/workflows/:id      → Delete a workflow
router.delete(
  '/:id',
  controller.deleteWorkflow,
);

export default router;
