import { type Types } from 'mongoose';
import { Workflow, type IWorkflow, type IWorkflowDocument } from '../models/Workflow.model';
import { ExecutionRun } from '../models/ExecutionRun.model';
import { AppError } from '../middleware/errorHandler.middleware';
import {
  type CreateWorkflowInput,
  type UpdateWorkflowInput,
  validateNodeConfig,
  validateEdgeReferences,
  validateUniqueNodeIds,
  isValidDAG,
} from '../validators/workflow.validator';

// ── Helpers ─────────────────────────────────────────────────

/**
 * Runs all cross-field validations on nodes and edges.
 * Throws AppError on first failure.
 */
function validateWorkflowGraph(
  nodes: CreateWorkflowInput['nodes'],
  edges: CreateWorkflowInput['edges'],
): void {
  // 1. Unique node IDs
  const uniqueCheck = validateUniqueNodeIds(nodes);
  if (!uniqueCheck.valid) {
    throw new AppError(400, 'DUPLICATE_NODE_IDS', `Duplicate node IDs: ${uniqueCheck.duplicates.join(', ')}`);
  }

  // 2. Edge references point to real nodes
  const refCheck = validateEdgeReferences(nodes, edges);
  if (!refCheck.valid) {
    throw new AppError(400, 'INVALID_EDGE_REFERENCES', refCheck.errors.join('; '));
  }

  // 3. No cycles
  if (!isValidDAG(nodes, edges)) {
    throw new AppError(400, 'CYCLE_DETECTED', 'Workflow contains a cycle. Edges must form a DAG.');
  }

  // 4. Each node's config matches its type
  for (const node of nodes) {
    const configCheck = validateNodeConfig(node.type, node.config as Record<string, unknown>);
    if (!configCheck.valid) {
      throw new AppError(400, 'INVALID_NODE_CONFIG', configCheck.error!);
    }
  }
}

// ── Service methods ─────────────────────────────────────────

export async function createWorkflow(
  userId: string,
  input: CreateWorkflowInput,
): Promise<IWorkflowDocument> {
  // Run graph validations if nodes/edges are provided
  if (input.nodes.length > 0 || input.edges.length > 0) {
    validateWorkflowGraph(input.nodes, input.edges);
  }

  const workflow = await Workflow.create({
    userId,
    name: input.name,
    description: input.description,
    nodes: input.nodes,
    edges: input.edges,
    isGeneratedByAI: input.isGeneratedByAI,
    generationMetadata: input.generationMetadata,
  });

  return workflow;
}

export async function getWorkflowById(
  workflowId: string,
  userId: string,
): Promise<IWorkflowDocument> {
  const workflow = await Workflow.findOne({ _id: workflowId, userId });

  if (!workflow) {
    throw new AppError(404, 'WORKFLOW_NOT_FOUND', 'Workflow not found');
  }

  return workflow;
}

export async function listWorkflows(
  userId: string,
): Promise<Array<Record<string, unknown>>> {
  // Keep the dashboard compact while deriving summaries at the database layer.
  return Workflow.aggregate([
    { $match: { userId } },
    { $sort: { updatedAt: -1 } },
    { $project: { userId: 1, name: 1, description: 1, isGeneratedByAI: 1, generationMetadata: 1, createdAt: 1, updatedAt: 1, nodeCount: { $size: { $ifNull: ['$nodes', []] } } } },
    {
      $lookup: {
        from: ExecutionRun.collection.name,
        let: { workflowId: '$_id', workflowUserId: '$userId' },
        pipeline: [
          { $match: { $expr: { $and: [{ $eq: ['$workflowId', '$$workflowId'] }, { $eq: ['$userId', '$$workflowUserId'] }] } } },
          { $sort: { createdAt: -1 } },
          { $limit: 1 },
          { $project: { _id: 0, status: 1 } },
        ],
        as: 'latestRun',
      },
    },
    { $set: { lastExecutionStatus: { $ifNull: [{ $arrayElemAt: ['$latestRun.status', 0] }, null] } } },
    { $project: { latestRun: 0 } },
  ]);
}

export async function listWorkflowDocuments(
  userId: string,
): Promise<WorkflowListDocument[]> {
  const workflows = await Workflow
    .find({ userId })
    .sort({ updatedAt: -1 }) // Most recently updated first
    .select('-nodes -edges')  // Exclude graph data from list — only load it when opening a specific workflow
    .lean<WorkflowListDocument[]>();

  return workflows;
}

type WorkflowListDocument = Pick<
  IWorkflow,
  'userId' | 'name' | 'description' | 'isGeneratedByAI' | 'generationMetadata' | 'createdAt' | 'updatedAt'
> & { _id: Types.ObjectId };

export async function updateWorkflow(
  workflowId: string,
  userId: string,
  input: UpdateWorkflowInput,
): Promise<IWorkflowDocument> {
  const workflow = await Workflow.findOne({ _id: workflowId, userId });

  if (!workflow) {
    throw new AppError(404, 'WORKFLOW_NOT_FOUND', 'Workflow not found');
  }

  // If nodes or edges are being updated, validate the new graph
  const newNodes = input.nodes ?? workflow.nodes;
  const newEdges = input.edges ?? workflow.edges;

  if (input.nodes || input.edges) {
    validateWorkflowGraph(
      newNodes as CreateWorkflowInput['nodes'],
      newEdges as CreateWorkflowInput['edges'],
    );
  }

  // Apply updates
  if (input.name !== undefined) workflow.name = input.name;
  if (input.description !== undefined) workflow.description = input.description;
  if (input.nodes !== undefined) workflow.nodes = input.nodes;
  if (input.edges !== undefined) workflow.edges = input.edges;
  if (input.generationMetadata !== undefined) workflow.generationMetadata = {
    ...input.generationMetadata,
    generatedAt: new Date(input.generationMetadata.generatedAt),
  };

  // Mark nodes/edges as modified since they're Mixed type
  if (input.nodes !== undefined) workflow.markModified('nodes');
  if (input.edges !== undefined) workflow.markModified('edges');
  if (input.generationMetadata !== undefined) workflow.markModified('generationMetadata');

  await workflow.save();
  return workflow;
}

export async function deleteWorkflow(
  workflowId: string,
  userId: string,
): Promise<void> {
  const result = await Workflow.deleteOne({ _id: workflowId, userId });

  if (result.deletedCount === 0) {
    throw new AppError(404, 'WORKFLOW_NOT_FOUND', 'Workflow not found');
  }
}
