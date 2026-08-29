import { Router } from 'express';
import * as controller from '../controllers/workflow.controller';
import { validateBody, validateParams, validateQuery } from '../middleware/validate.middleware';
import {
  createWorkflowSchema,
  restoreWorkflowRevisionSchema,
  updateWorkflowSchema,
  workflowRevisionHistoryQuerySchema,
  workflowRevisionComparisonParamsSchema,
  workflowRevisionParamsSchema,
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

// GET    /api/workflows/:id/revisions → List bounded revision history
router.get(
  '/:id/revisions',
  validateQuery(workflowRevisionHistoryQuerySchema),
  controller.listWorkflowRevisions,
);

// GET    /api/workflows/:id/revisions/:fromRevision/compare/:toRevision
router.get(
  '/:id/revisions/:fromRevision/compare/:toRevision',
  validateParams(workflowRevisionComparisonParamsSchema),
  controller.compareWorkflowRevisions,
);

// GET    /api/workflows/:id/revisions/:revision → Get an exact immutable revision
router.get(
  '/:id/revisions/:revision',
  validateParams(workflowRevisionParamsSchema),
  controller.getWorkflowRevision,
);

// GET    /api/workflows/:id/ai-prompt-context → Resolve current definition AI lineage
router.get(
  '/:id/ai-prompt-context',
  controller.getWorkflowAiPromptContext,
);

// POST   /api/workflows/:id/revisions/:revision/restore → Restore as a new revision
router.post(
  '/:id/revisions/:revision/restore',
  validateParams(workflowRevisionParamsSchema),
  validateBody(restoreWorkflowRevisionSchema),
  controller.restoreWorkflowRevision,
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
