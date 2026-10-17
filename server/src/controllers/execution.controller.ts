import { type Request, type Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import * as engine from '../services/execution/executionEngine';
import { simulateOwnedWorkflow } from '../services/execution/workflowSimulation';
import { redactText } from '../utils/redact';

// ── POST /api/executions/:workflowId/run ────────────────────

export const runWorkflow = asyncHandler(async (req: Request, res: Response) => {
  const { workflowId } = req.params;

  const run = await engine.startExecution(workflowId, req.userId!, 'manual');

  // Return the full run with pending step logs so the UI shows all nodes immediately
  res.status(201).json({ data: run });

  // Execute async — the engine emits socket events as it processes each node
  engine.runExecution(run).catch((err) => {
    console.error(`[execution] Unhandled error for run ${run._id}:`, redactText(err instanceof Error ? err.message : String(err)));
  });
});

// ── POST /api/executions/:workflowId/simulate ───────────────

export const simulateWorkflow = asyncHandler(async (req: Request, res: Response) => {
  const result = await simulateOwnedWorkflow(req.params.workflowId, req.userId!, req.body);
  res.status(200).json({ data: result });
});

// ── GET /api/executions/:runId ──────────────────────────────

export const getExecution = asyncHandler(async (req: Request, res: Response) => {
  const run = await engine.getExecutionById(req.params.runId, req.userId!);
  res.json({ data: run });
});

// ── GET /api/executions/run/:runId/provenance ──────────────

export const getExecutionRevisionProvenance = asyncHandler(async (req: Request, res: Response) => {
  const provenance = await engine.getExecutionRevisionProvenance(req.params.runId, req.userId!);
  res.json({ data: provenance });
});

// ── GET /api/executions/workflow/:workflowId ────────────────

export const listExecutions = asyncHandler(async (req: Request, res: Response) => {
  const runs = await engine.listExecutions(req.params.workflowId, req.userId!);
  res.json({ data: runs });
});
