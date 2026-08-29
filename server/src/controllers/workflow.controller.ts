import { type Request, type Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import * as workflowService from '../services/workflow.service';

// ── POST /api/workflows ─────────────────────────────────────

export const createWorkflow = asyncHandler(async (req: Request, res: Response) => {
  const workflow = await workflowService.createWorkflow(req.userId!, req.body);
  res.status(201).json({ data: workflow });
});

// ── GET /api/workflows ──────────────────────────────────────

export const listWorkflows = asyncHandler(async (req: Request, res: Response) => {
  const workflows = await workflowService.listWorkflows(req.userId!);
  res.json({ data: workflows });
});

// ── GET /api/workflows/:id ──────────────────────────────────

export const getWorkflow = asyncHandler(async (req: Request, res: Response) => {
  const workflow = await workflowService.getWorkflowById(req.params.id, req.userId!);
  res.json({ data: workflow });
});

// ── GET /api/workflows/:id/ai-prompt-context ───────────────

export const getWorkflowAiPromptContext = asyncHandler(async (req: Request, res: Response) => {
  const context = await workflowService.getWorkflowAiPromptContext(req.params.id, req.userId!);
  res.json({ data: context });
});

// ── GET /api/workflows/:id/revisions ────────────────────────

export const listWorkflowRevisions = asyncHandler(async (req: Request, res: Response) => {
  const history = await workflowService.listWorkflowRevisions(req.params.id, req.userId!, {
    limit: Number(req.query.limit),
    ...(req.query.beforeRevision !== undefined
      ? { beforeRevision: Number(req.query.beforeRevision) }
      : {}),
  });
  res.json({ data: history });
});

// ── GET /api/workflows/:id/revisions/:revision ──────────────

export const getWorkflowRevision = asyncHandler(async (req: Request, res: Response) => {
  const revision = await workflowService.getWorkflowRevision(
    req.params.id,
    req.userId!,
    Number(req.params.revision),
  );
  res.json({ data: revision });
});

// ── GET /api/workflows/:id/revisions/:fromRevision/compare/:toRevision ──

export const compareWorkflowRevisions = asyncHandler(async (req: Request, res: Response) => {
  const comparison = await workflowService.compareWorkflowRevisions(
    req.params.id,
    req.userId!,
    Number(req.params.fromRevision),
    Number(req.params.toRevision),
  );
  res.json({ data: comparison });
});

// ── POST /api/workflows/:id/revisions/:revision/restore ─────

export const restoreWorkflowRevision = asyncHandler(async (req: Request, res: Response) => {
  const workflow = await workflowService.restoreWorkflowRevision(
    req.params.id,
    req.userId!,
    Number(req.params.revision),
    req.body,
  );
  res.status(201).json({ data: workflow });
});

// ── PUT /api/workflows/:id ──────────────────────────────────

export const updateWorkflow = asyncHandler(async (req: Request, res: Response) => {
  const workflow = await workflowService.updateWorkflow(req.params.id, req.userId!, req.body);
  res.json({ data: workflow });
});

// ── DELETE /api/workflows/:id ───────────────────────────────

export const deleteWorkflow = asyncHandler(async (req: Request, res: Response) => {
  await workflowService.deleteWorkflow(req.params.id, req.userId!);
  res.status(204).send();
});
