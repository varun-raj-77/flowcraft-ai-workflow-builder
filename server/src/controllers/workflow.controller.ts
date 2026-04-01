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
