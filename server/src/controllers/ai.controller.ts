import { type Request, type Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import * as aiService from '../services/ai.service';

// ── POST /api/ai/generate ───────────────────────────────────

export const generateWorkflow = asyncHandler(async (req: Request, res: Response) => {
  const { prompt } = req.body;

  const workflow = await aiService.generateWorkflow(prompt);

  res.json({ data: workflow });
});
