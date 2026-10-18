import { Workflow } from '../../models/Workflow.model';
import { WorkflowRevision } from '../../models/WorkflowRevision.model';
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
import { redactSecrets, redactText } from '../../utils/redact';
import { TransformExecutionError, type TransformDiagnostic } from './executors/transformDiagnostics';
import { normalizeAndValidateWorkflowGraph } from '../workflowDefinition';
import { runInTransaction } from '../../utils/mongoTransaction';
import { verifyWorkflowRevisionIntegrity } from '../workflowRevisionIntegrity';
import {
  EXECUTION_HEARTBEAT_MS,
  ExecutionLeaseLostError,
  newExecutionLease,
  renewExecutionLease,
  persistExecutionSnapshot,
} from './executionRecovery';

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

export interface ExecutionRevisionProvenance {
  status: 'pinned' | 'legacy' | 'unavailable' | 'integrity_error';
  runId: string;
  workflowId: string;
  workflowRevision?: number;
  workflowRevisionId?: string;
  definitionHash?: string;
  currentRevision?: number;
  isCurrent: boolean;
  canView: boolean;
  canCompare: boolean;
  message?: string;
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

/**
 * Persist a terminal failure before notifying connected clients.
 * Pending nodes did not run; a node left "running" by an infrastructure error
 * is marked failed. Do not expose arbitrary infrastructure exception messages.
 */
async function finalizeFailedRun(
  run: IExecutionRunDocument,
  message: string,
): Promise<IExecutionRunDocument> {
  const completedAt = new Date();
  run.status = 'failed';
  run.error = redactText(message);
  run.completedAt = completedAt;
  for (const step of run.stepLogs) {
    if (step.status === 'pending') {
      step.status = 'skipped';
    } else if (step.status === 'running') {
      step.status = 'failed';
      step.completedAt = completedAt;
      step.durationMs = step.startedAt ? Math.max(0, completedAt.getTime() - step.startedAt.getTime()) : 0;
      step.error = 'Execution failed unexpectedly';
    }
  }
  run.markModified('stepLogs');
  await persistExecutionSnapshot(run);
  emitExecutionComplete(run._id.toString(), 'failed', run.error);
  return run;
}

// ── Engine ──────────────────────────────────────────────────

/**
 * Run Initialization: Creates the ExecutionRun document with pending step logs.
 * Returns immediately so the controller can respond with the run ID.
 * The client joins the socket room, then Run Processing begins.
 */
export async function startExecution(
  workflowId: string,
  userId: string,
  triggerType: 'manual' | 'ai_generated' = 'manual',
): Promise<IExecutionRunDocument> {
  return runInTransaction(async (session) => {
    const workflow = await Workflow.findOne({ _id: workflowId, userId }).session(session);
    if (!workflow) {
      throw new AppError(404, 'WORKFLOW_NOT_FOUND', 'Workflow not found');
    }

    if (!workflow.currentRevisionId || !workflow.currentRevision) {
      throw new AppError(409, 'WORKFLOW_MIGRATION_REQUIRED', 'Workflow must be migrated before execution');
    }

    const revision = await WorkflowRevision.findOne({
      _id: workflow.currentRevisionId,
      workflowId: workflow._id,
      userId,
      revision: workflow.currentRevision,
    }).session(session);
    if (!revision) {
      throw new AppError(409, 'WORKFLOW_REVISION_MISSING', 'The current workflow revision could not be resolved');
    }

    const graph = normalizeAndValidateWorkflowGraph(revision.nodes, revision.edges);
    const nodes = graph.nodes as unknown as WorkflowNode[];
    const edges = graph.edges as unknown as WorkflowEdge[];
    verifyWorkflowRevisionIntegrity(revision);

    if (nodes.length === 0) {
      throw new AppError(400, 'EMPTY_WORKFLOW', 'Cannot execute an empty workflow');
    }

    const executionOrder = topologicalSort(nodes, edges);
    const nodeMap = new Map<string, WorkflowNode>();
    for (const node of nodes) nodeMap.set(node.id, node);
    const stepLogs: IStepLog[] = executionOrder.map((nodeId) => {
      const node = nodeMap.get(nodeId)!;
      return { nodeId, nodeType: node.type, nodeLabel: node.label, status: 'pending' as const };
    });

    const pointerGuard = await Workflow.updateOne(
      {
        _id: workflow._id,
        userId,
        currentRevisionId: revision._id,
        currentRevision: revision.revision,
      },
      { $set: { currentRevision: revision.revision } },
      { session, timestamps: false },
    );
    if (pointerGuard.matchedCount !== 1) {
      throw new AppError(409, 'WORKFLOW_REVISION_CONFLICT', 'Workflow changed while execution was starting');
    }

    const [run] = await ExecutionRun.create([{
      workflowId: workflow._id,
      workflowRevisionId: revision._id,
      workflowRevision: revision.revision,
      definitionHash: revision.definitionHash,
      userId,
      status: 'running',
      ...newExecutionLease(),
      startedAt: new Date(),
      triggerType,
      stepLogs,
      executionOrder,
    }], { session });
    return run;
  });
}

/**
 * Run Processing: Walks nodes in topological order, executing each one.
 * Emits socket events as it goes. Called AFTER the run ID is returned to the client.
 */
export async function runExecution(
  run: IExecutionRunDocument,
): Promise<IExecutionRunDocument> {
  let leaseLost = false;
  const checkLease = async () => {
    if (leaseLost) throw new ExecutionLeaseLostError();
    try {
      await renewExecutionLease(run);
    } catch {
      leaseLost = true;
      throw new ExecutionLeaseLostError();
    }
  };
  // Heartbeats continue while nodes await external HTTP and QuickJS workers.
  // Failure is fail-stop: no later nodes may run and terminal writes are fenced.
  const timer = run.leaseOwner ? setInterval(() => {
    void renewExecutionLease(run).catch(() => { leaseLost = true; });
  }, EXECUTION_HEARTBEAT_MS) : undefined;
  timer?.unref();

  try {
    await checkLease();
    return await processExecution(run, checkLease);
  } catch (error) {
    // Recovery may already have committed a failure. A stale worker must never
    // overwrite that state, send a misleading event or run a following node.
    if (error instanceof ExecutionLeaseLostError || leaseLost) return run;
    return finalizeFailedRun(run, 'Execution failed unexpectedly');
  } finally {
    if (timer) clearInterval(timer);
  }
}

async function processExecution(
  run: IExecutionRunDocument,
  checkLease: () => Promise<void>,
): Promise<IExecutionRunDocument> {
  if (!run.workflowRevisionId || !run.workflowRevision || !run.definitionHash) {
    return finalizeFailedRun(run, 'Execution run has no pinned workflow revision');
  }

  const revision = await WorkflowRevision.findOne({
    _id: run.workflowRevisionId,
    workflowId: run.workflowId,
    userId: run.userId,
    revision: run.workflowRevision,
    definitionHash: run.definitionHash,
  });
  if (!revision) {
    return finalizeFailedRun(run, 'Pinned workflow revision not found');
  }

  let graph: ReturnType<typeof normalizeAndValidateWorkflowGraph>;
  try {
    graph = normalizeAndValidateWorkflowGraph(revision.nodes, revision.edges);
    verifyWorkflowRevisionIntegrity(revision);
  } catch {
    // Integrity/parsing diagnostics may contain saved source: fail closed.
    return finalizeFailedRun(run, 'Pinned workflow revision failed validation');
  }

  const nodes = graph.nodes as unknown as WorkflowNode[];
  const edges = graph.edges as unknown as WorkflowEdge[];
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
      await checkLease();
      const node = nodeMap.get(nodeId)!
      const logIndex = run.stepLogs.findIndex((l) => l.nodeId === nodeId);

      // ── Skip check ──────────────────────────────────────
      if (skippedNodes.has(nodeId)) {
        run.stepLogs[logIndex].status = 'skipped';
        run.markModified('stepLogs');
        await persistExecutionSnapshot(run);
        emitNodeStatus(run._id.toString(), nodeId, 'skipped');
        continue;
      }

      // ── Mark as running ─────────────────────────────────
      run.stepLogs[logIndex].status = 'running';
      run.stepLogs[logIndex].startedAt = new Date();
      run.markModified('stepLogs');
      await persistExecutionSnapshot(run);
      await checkLease();
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
        await checkLease();

        // ── Record success ──────────────────────────────
        const now = new Date();
        run.stepLogs[logIndex].status = 'success';
        run.stepLogs[logIndex].completedAt = now;
        run.stepLogs[logIndex].durationMs =
          now.getTime() - run.stepLogs[logIndex].startedAt!.getTime();
        run.stepLogs[logIndex].output = truncateOutput(result.output);

        // Persist the checkpoint before showing success or running successors.
        run.markModified('stepLogs');
        await persistExecutionSnapshot(run);
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
        if (err instanceof ExecutionLeaseLostError) throw err;
        await checkLease();
        // ── Record failure ──────────────────────────────
        const now = new Date();
        const transformDiagnostic = err instanceof TransformExecutionError
          ? redactSecrets({
            ...err.diagnostic,
            originalError: redactText(err.diagnostic.originalError),
            nodeId,
            nodeName: node.label,
            upstreamNodeName: err.diagnostic.upstreamNodeId ? nodeMap.get(err.diagnostic.upstreamNodeId)?.label : undefined,
          }) as TransformDiagnostic & Record<string, unknown> & { nodeId: string; nodeName: string; upstreamNodeName?: string }
          : undefined;
        const message = transformDiagnostic?.message ?? redactText(err instanceof Error ? err.message : String(err));

        run.stepLogs[logIndex].status = 'failed';
        run.stepLogs[logIndex].completedAt = now;
        run.stepLogs[logIndex].durationMs =
          now.getTime() - run.stepLogs[logIndex].startedAt!.getTime();
        run.stepLogs[logIndex].error = message;
        if (transformDiagnostic) run.stepLogs[logIndex].diagnostic = transformDiagnostic;

        emitNodeStatus(run._id.toString(), nodeId, 'failed', { error: message, diagnostic: transformDiagnostic });

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
        run.error = redactText(`Node "${node.label}" (${nodeId}) failed: ${message}`);
        run.completedAt = now;

        run.markModified('stepLogs');
        await persistExecutionSnapshot(run);
        emitExecutionComplete(run._id.toString(), 'failed', run.error);
        return run;
      }
    }

    // ── 5. Finalize as completed ────────────────────────────
    run.status = 'completed';
    run.completedAt = new Date();

    run.markModified('stepLogs');
    await checkLease();
    await persistExecutionSnapshot(run);
    emitExecutionComplete(run._id.toString(), 'completed');
    return run;
  } catch (error) {
    if (error instanceof ExecutionLeaseLostError) throw error;
    // Unexpected engine errors enter the outer terminal failure boundary.
    throw new Error('Execution failed unexpectedly');
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

/** Resolve one run's immutable definition without ever falling back to the current graph. */
export async function getExecutionRevisionProvenance(
  runId: string,
  userId: string,
): Promise<ExecutionRevisionProvenance> {
  const run = await ExecutionRun.findOne({ _id: runId, userId });
  if (!run) {
    throw new AppError(404, 'EXECUTION_NOT_FOUND', 'Execution run not found');
  }

  const base = {
    runId: run._id.toString(),
    workflowId: run.workflowId.toString(),
    isCurrent: false,
    canView: false,
    canCompare: false,
  };
  const pinnedValues = [run.workflowRevisionId, run.workflowRevision, run.definitionHash];
  if (pinnedValues.every((value) => value === undefined || value === null)) {
    return {
      ...base,
      status: 'legacy',
      message: 'This legacy run did not capture an exact workflow revision.',
    };
  }
  if (pinnedValues.some((value) => value === undefined || value === null)) {
    return {
      ...base,
      status: 'integrity_error',
      message: 'This run has incomplete workflow revision provenance.',
    };
  }

  const workflowRevision = run.workflowRevision!;
  const workflowRevisionId = run.workflowRevisionId!;
  const definitionHash = run.definitionHash!;
  const pinned = {
    ...base,
    workflowRevision,
    workflowRevisionId: workflowRevisionId.toString(),
    definitionHash,
  };
  const workflow = await Workflow.findOne({ _id: run.workflowId, userId });
  if (!workflow) {
    return {
      ...pinned,
      status: 'unavailable',
      message: 'The workflow associated with this execution is no longer available.',
    };
  }

  const currentRevision = workflow.currentRevision;
  const revision = await WorkflowRevision.findOne({
    _id: workflowRevisionId,
    workflowId: run.workflowId,
    userId,
    revision: workflowRevision,
  });
  if (!revision) {
    return {
      ...pinned,
      currentRevision,
      status: 'unavailable',
      message: 'The exact workflow revision used by this execution is unavailable.',
    };
  }
  if (revision.definitionHash !== definitionHash) {
    return {
      ...pinned,
      currentRevision,
      status: 'integrity_error',
      message: 'The execution hash does not match its pinned workflow revision.',
    };
  }

  try {
    verifyWorkflowRevisionIntegrity(revision);
  } catch {
    return {
      ...pinned,
      currentRevision,
      status: 'integrity_error',
      message: 'The pinned workflow revision failed its integrity check.',
    };
  }

  const isCurrent = currentRevision === workflowRevision;
  return {
    ...pinned,
    currentRevision,
    status: 'pinned',
    isCurrent,
    canView: true,
    canCompare: currentRevision !== undefined && !isCurrent,
  };
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
    .select('-leaseOwner -leaseHeartbeatAt -leaseExpiresAt')
    .lean() as unknown as IExecutionRunDocument[];
}
