import { type Request, type Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import * as aiService from '../services/ai.service';
import * as aiWorkflowService from '../services/aiWorkflow.service';

// ── POST /api/ai/generate ───────────────────────────────────

export const generateWorkflow = asyncHandler(async (req: Request, res: Response) => {
  const { prompt } = req.body;

  const workflow = await aiService.generateWorkflow(prompt);

  res.json({ data: workflow });
});

// ── POST /api/ai/workflows/:workflowId/regenerate ──────────

export const regenerateWorkflow = asyncHandler(async (req: Request, res: Response) => {
  const workflow = await aiWorkflowService.regenerateWorkflow(
    req.params.workflowId,
    req.userId!,
    req.body,
  );
  res.status(201).json({ data: workflow });
});
