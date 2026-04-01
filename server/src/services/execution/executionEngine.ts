import { Workflow, type IWorkflowDocument } from '../../models/Workflow.model';
import {
  ExecutionRun,
  type IExecutionRunDocument,
  type IStepLog,
} from '../../models/ExecutionRun.model';
import { AppError } from '../../middleware/errorHandler.middleware';
import { topologicalSort, findSkippedNodes } from './dagUtils';
import { type ExecutionContext, truncateOutput } from './templateEngine';
import { getExecutor } from './executors';
import { getIO } from '../../config/socket';

// ── Types ───────────────────────────────────────────────────

interface WorkflowNode {
  id: string;
  type: string;
  label: string;
  config: Record<string, unknown>;
}

interface WorkflowEdge {
  source: string;
  target: string;
  sourceHandle?: string;
  conditionBranch?: string;
}

// ── Socket emission helper ──────────────────────────────────

function emitNodeStatus(
  runId: string,
  nodeId: string,
  status: string,
  data?: Record<string, unknown>,
) {
  try {
    const io = getIO();
    io.to(`execution:${runId}`).emit('node:status', {
      runId,
      nodeId,
      status,
      ...data,
    });
  } catch {
    // Socket not initialized (e.g. in tests) — silently skip
  }
}

function emitExecutionComplete(
  runId: string,
  status: string,
  error?: string,
) {
  try {
    const io = getIO();
    io.to(`execution:${runId}`).emit('execution:complete', {
      runId,
      status,
      error,
    });
  } catch {
    // Socket not initialized — silently skip
  }
}

// ── Engine ──────────────────────────────────────────────────

/**
 * Phase 1: Creates the ExecutionRun document with pending step logs.
 * Returns immediately so the controller can respond with the run ID.
 * The client joins the socket room, then Phase 2 begins.
 */
export async function startExecution(
  workflowId: string,
  userId: string,
  triggerType: 'manual' | 'ai_generated' = 'manual',
): Promise<IExecutionRunDocument> {
  const workflow = await Workflow.findOne({ _id: workflowId, userId });
  if (!workflow) {
    throw new AppError(404, 'WORKFLOW_NOT_FOUND', 'Workflow not found');
  }

  const nodes = workflow.nodes as unknown as WorkflowNode[];
  const edges = workflow.edges as unknown as WorkflowEdge[];

  if (nodes.length === 0) {
    throw new AppError(400, 'EMPTY_WORKFLOW', 'Cannot execute an empty workflow');
  }

  const executionOrder = topologicalSort(nodes, edges);

  const nodeMap = new Map<string, WorkflowNode>();
  for (const node of nodes) {
    nodeMap.set(node.id, node);
  }

  const stepLogs: IStepLog[] = executionOrder.map((nodeId) => {
    const node = nodeMap.get(nodeId)!;
    return {
      nodeId,
      nodeType: node.type,
      nodeLabel: node.label,
      status: 'pending' as const,
    };
  });

  const run = await ExecutionRun.create({
    workflowId: workflow._id,
    userId,
    status: 'running',
    startedAt: new Date(),
    triggerType,
    stepLogs,
    executionOrder,
  });

  return run;
}

/**
 * Phase 2: Walks nodes in topological order, executing each one.
 * Emits socket events as it goes. Called AFTER the run ID is returned to the client.
 */
export async function runExecution(
  run: IExecutionRunDocument,
): Promise<IExecutionRunDocument> {
  const workflow = await Workflow.findById(run.workflowId);
  if (!workflow) {
    run.status = 'failed';
    run.error = 'Workflow not found';
    run.completedAt = new Date();
    await run.save();
    emitExecutionComplete(run._id.toString(), 'failed', run.error);
    return run;
  }

  const nodes = workflow.nodes as unknown as WorkflowNode[];
  const edges = workflow.edges as unknown as WorkflowEdge[];
  const executionOrder = run.executionOrder;

  const nodeMap = new Map<string, WorkflowNode>();
  for (const node of nodes) {
    nodeMap.set(node.id, node);
  }

  const context: ExecutionContext = new Map();
  const skippedNodes = new Set<string>();

  // Small delay to give the client time to join the socket room
  await new Promise((resolve) => setTimeout(resolve, 100));

  try {
    for (const nodeId of executionOrder) {
      const node = nodeMap.get(nodeId)!;
      const logIndex = run.stepLogs.findIndex((l) => l.nodeId === nodeId);

      // ── Skip check ──────────────────────────────────────
      if (skippedNodes.has(nodeId)) {
        run.stepLogs[logIndex].status = 'skipped';
        emitNodeStatus(run._id.toString(), nodeId, 'skipped');
        continue;
      }

      // ── Mark as running ─────────────────────────────────
      run.stepLogs[logIndex].status = 'running';
      run.stepLogs[logIndex].startedAt = new Date();
      emitNodeStatus(run._id.toString(), nodeId, 'running');

      try {
        // ── Execute ─────────────────────────────────────
        const executor = getExecutor(node.type);

        // Record the input (config being used)
        run.stepLogs[logIndex].input = truncateOutput(
          { config: node.config },
        );

        const result = await executor({
          nodeId,
          config: node.config,
          context,
        });

        // ── Record success ──────────────────────────────
        const now = new Date();
        run.stepLogs[logIndex].status = 'success';
        run.stepLogs[logIndex].completedAt = now;
        run.stepLogs[logIndex].durationMs =
          now.getTime() - run.stepLogs[logIndex].startedAt!.getTime();
        run.stepLogs[logIndex].output = truncateOutput(result.output);

        // Store output in context for downstream nodes
        context.set(nodeId, result.output);

        emitNodeStatus(run._id.toString(), nodeId, 'success', {
          output: run.stepLogs[logIndex].output,
          durationMs: run.stepLogs[logIndex].durationMs,
        });

        // ── Handle condition branching ──────────────────
        if (node.type === 'condition') {
          const branchTaken = result.output.branchTaken as 'true' | 'false';
          const newSkipped = findSkippedNodes(
            nodeId,
            branchTaken,
            edges,
            skippedNodes,
          );
          for (const skippedId of newSkipped) {
            skippedNodes.add(skippedId);
          }
        }
      } catch (err: unknown) {
        // ── Record failure ──────────────────────────────
        const now = new Date();
        const message = err instanceof Error ? err.message : String(err);

        run.stepLogs[logIndex].status = 'failed';
        run.stepLogs[logIndex].completedAt = now;
        run.stepLogs[logIndex].durationMs =
          now.getTime() - run.stepLogs[logIndex].startedAt!.getTime();
        run.stepLogs[logIndex].error = message;

        emitNodeStatus(run._id.toString(), nodeId, 'failed', { error: message });

        // Mark all remaining nodes as skipped
        const remaining = executionOrder.slice(executionOrder.indexOf(nodeId) + 1);
        for (const remainingId of remaining) {
          const remainingIndex = run.stepLogs.findIndex((l) => l.nodeId === remainingId);
          if (remainingIndex >= 0 && run.stepLogs[remainingIndex].status === 'pending') {
            run.stepLogs[remainingIndex].status = 'skipped';
          }
        }

        // Finalize as failed
        run.status = 'failed';
        run.error = `Node "${node.label}" (${nodeId}) failed: ${message}`;
        run.completedAt = now;

        run.markModified('stepLogs');
        await run.save();
        emitExecutionComplete(run._id.toString(), 'failed', run.error);
        return run;
      }
    }

    // ── 5. Finalize as completed ────────────────────────────
    run.status = 'completed';
    run.completedAt = new Date();

    run.markModified('stepLogs');
    await run.save();
    emitExecutionComplete(run._id.toString(), 'completed');
    return run;
  } catch (err: unknown) {
    // Unexpected engine-level error
    run.status = 'failed';
    run.error = err instanceof Error ? err.message : 'Unexpected engine error';
    run.completedAt = new Date();

    run.markModified('stepLogs');
    await run.save();
    return run;
  }
}

/**
 * Get an execution run by ID.
 */
export async function getExecutionById(
  runId: string,
  userId: string,
): Promise<IExecutionRunDocument> {
  const run = await ExecutionRun.findOne({ _id: runId, userId });
  if (!run) {
    throw new AppError(404, 'EXECUTION_NOT_FOUND', 'Execution run not found');
  }
  return run;
}

/**
 * List execution runs for a workflow.
 */
export async function listExecutions(
  workflowId: string,
  userId: string,
): Promise<IExecutionRunDocument[]> {
  return ExecutionRun
    .find({ workflowId, userId })
    .sort({ createdAt: -1 })
    .limit(20)
    .lean() as unknown as IExecutionRunDocument[];
}
