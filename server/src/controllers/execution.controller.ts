import { type Request, type Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import * as engine from '../services/execution/executionEngine';

// ── POST /api/executions/:workflowId/run ────────────────────

export const runWorkflow = asyncHandler(async (req: Request, res: Response) => {
  const { workflowId } = req.params;

  const run = await engine.startExecution(workflowId, req.userId!, 'manual');

  // Return the full run with pending step logs so the UI shows all nodes immediately
  res.status(201).json({ data: run });

  // Execute async — the engine emits socket events as it processes each node
  engine.runExecution(run).catch((err) => {
    console.error(`[execution] Unhandled error for run ${run._id}:`, err);
  });
});

// ── GET /api/executions/:runId ──────────────────────────────

export const getExecution = asyncHandler(async (req: Request, res: Response) => {
  const run = await engine.getExecutionById(req.params.runId, req.userId!);
  res.json({ data: run });
});

// ── GET /api/executions/workflow/:workflowId ────────────────

export const listExecutions = asyncHandler(async (req: Request, res: Response) => {
  const runs = await engine.listExecutions(req.params.workflowId, req.userId!);
  res.json({ data: runs });
});
