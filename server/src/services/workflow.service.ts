import { type ClientSession, type Types } from 'mongoose';
import { Workflow, type IWorkflow, type IWorkflowDocument } from '../models/Workflow.model';
import { WorkflowRevision, type IWorkflowRevisionDocument, type WorkflowRevisionSource } from '../models/WorkflowRevision.model';
import { ExecutionRun } from '../models/ExecutionRun.model';
import { AppError } from '../middleware/errorHandler.middleware';
import {
  type CreateWorkflowInput,
  type RestoreWorkflowRevisionInput,
  type UpdateWorkflowInput,
  type WorkflowRevisionHistoryQuery,
} from '../validators/workflow.validator';
import { assertTransactionCapability, runInTransaction } from '../utils/mongoTransaction';
import {
  calculateDefinitionHash,
  normalizeAndValidateWorkflowGraph,
  validateWorkflowGraph,
  type WorkflowDefinition,
  type WorkflowGenerationMetadata,
} from './workflowDefinition';
import {
  compareWorkflowRevisionDefinitions,
  type WorkflowRevisionComparison,
} from './workflowComparison';
import {
  resolveWorkflowAiPromptLineage,
  type AiLineageRevision,
  type WorkflowAiPromptContext,
} from './workflowAiLineage';
import type { GeneratedWorkflow } from './ai.service';
import { verifyWorkflowRevisionIntegrity } from './workflowRevisionIntegrity';
import {
  forEachWorkflowBounded,
  inspectWorkflowRevisionState,
} from './workflowRevisionMaintenance';

export interface HydratedWorkflow {
  _id: string;
  userId: string;
  name: string;
  description?: string;
  isGeneratedByAI: boolean;
  currentRevisionId: string;
  currentRevision: number;
  definitionHash: string;
  nodes: IWorkflowRevisionDocument['nodes'];
  edges: IWorkflowRevisionDocument['edges'];
  generationMetadata?: IWorkflowRevisionDocument['generationMetadata'];
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkflowRevisionSummary {
  id: string;
  revision: number;
  parentRevisionId: string | null;
  source: WorkflowRevisionSource;
  definitionHash: string;
  restoredFromRevisionId?: string;
  restoredFromRevision?: number;
  createdAt: Date;
  nodeCount: number;
  edgeCount: number;
}

export interface WorkflowRevisionDetail {
  id: string;
  workflowId: string;
  revision: number;
  parentRevisionId: string | null;
  source: WorkflowRevisionSource;
  definitionHash: string;
  restoredFromRevisionId?: string;
  nodes: IWorkflowRevisionDocument['nodes'];
  edges: IWorkflowRevisionDocument['edges'];
  generationMetadata?: IWorkflowRevisionDocument['generationMetadata'];
  createdAt: Date;
}

export interface WorkflowRevisionHistoryPage {
  revisions: WorkflowRevisionSummary[];
  nextBeforeRevision: number | null;
}

export interface MigrationEvent {
  workflowId: string;
  status: 'would_migrate' | 'migrated' | 'already_migrated' | 'skipped' | 'invalid' | 'integrity_error' | 'failed';
  code?: string;
  error?: string;
}

export interface MigrationSummary {
  scanned: number;
  wouldMigrate: number;
  migrated: number;
  alreadyMigrated: number;
  skipped: number;
  invalid: number;
  integrityErrors: number;
  failed: number;
  failures: Array<{ workflowId: string; code: string }>;
}

export interface MigrationOptions {
  dryRun?: boolean;
  batchSize?: number;
  transactionCapabilityCheck?: () => Promise<void>;
}

function isDuplicateKeyError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 11000);
}

function toHashableMetadata(
  metadata: IWorkflowRevisionDocument['generationMetadata'] | IWorkflowDocument['generationMetadata'] | CreateWorkflowInput['generationMetadata'],
): WorkflowGenerationMetadata | undefined {
  if (!metadata) return undefined;
  const value = typeof (metadata as { toObject?: () => unknown }).toObject === 'function'
    ? (metadata as unknown as { toObject: () => Record<string, unknown> }).toObject()
    : metadata;
  return value as WorkflowGenerationMetadata;
}

function hydrateWorkflow(
  workflow: IWorkflowDocument,
  revision: IWorkflowRevisionDocument,
): HydratedWorkflow {
  return {
    _id: workflow._id.toString(),
    userId: workflow.userId,
    name: workflow.name,
    description: workflow.description,
    isGeneratedByAI: workflow.isGeneratedByAI,
    currentRevisionId: revision._id.toString(),
    currentRevision: revision.revision,
    definitionHash: revision.definitionHash,
    nodes: revision.nodes,
    edges: revision.edges,
    generationMetadata: revision.generationMetadata,
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt,
  };
}

function assertRevisionPointer(workflow: IWorkflowDocument): asserts workflow is IWorkflowDocument & {
  currentRevisionId: Types.ObjectId;
  currentRevision: number;
} {
  if (!workflow.currentRevisionId || !workflow.currentRevision) {
    throw new AppError(
      409,
      'WORKFLOW_MIGRATION_REQUIRED',
      'Workflow must be migrated to immutable revisions before it can be used',
    );
  }
}

async function loadOwnedCurrentRevision(
  workflow: IWorkflowDocument,
  userId: string,
  session?: ClientSession,
): Promise<IWorkflowRevisionDocument> {
  assertRevisionPointer(workflow);
  let query = WorkflowRevision.findOne({
    _id: workflow.currentRevisionId,
    workflowId: workflow._id,
    userId,
    revision: workflow.currentRevision,
  });
  if (session) query = query.session(session);
  const revision = await query;
  if (!revision) {
    throw new AppError(409, 'WORKFLOW_REVISION_MISSING', 'The current workflow revision could not be resolved');
  }
  verifyWorkflowRevisionIntegrity(revision);
  return revision;
}

async function createRevision(
  params: {
    workflowId: Types.ObjectId;
    userId: string;
    revision: number;
    parentRevisionId: Types.ObjectId | null;
    source: WorkflowRevisionSource;
    definition: WorkflowDefinition;
    restoredFromRevisionId?: Types.ObjectId;
  },
  session: ClientSession,
): Promise<IWorkflowRevisionDocument> {
  const [revision] = await WorkflowRevision.create([{
    workflowId: params.workflowId,
    userId: params.userId,
    revision: params.revision,
    parentRevisionId: params.parentRevisionId,
    source: params.source,
    nodes: params.definition.nodes,
    edges: params.definition.edges,
    generationMetadata: params.definition.generationMetadata,
    restoredFromRevisionId: params.restoredFromRevisionId,
    definitionHash: calculateDefinitionHash(params.definition),
  }], { session });
  return revision;
}

function serializeRevision(revision: IWorkflowRevisionDocument): WorkflowRevisionDetail {
  return {
    id: revision._id.toString(),
    workflowId: revision.workflowId.toString(),
    revision: revision.revision,
    parentRevisionId: revision.parentRevisionId?.toString() ?? null,
    source: revision.source,
    definitionHash: revision.definitionHash,
    restoredFromRevisionId: revision.restoredFromRevisionId?.toString(),
    nodes: revision.nodes,
    edges: revision.edges,
    generationMetadata: revision.generationMetadata,
    createdAt: revision.createdAt,
  };
}

function toAiLineageRevision(revision: IWorkflowRevisionDocument): AiLineageRevision {
  return {
    id: revision._id.toString(),
    revision: revision.revision,
    source: revision.source,
    parentRevisionId: revision.parentRevisionId?.toString() ?? null,
    restoredFromRevisionId: revision.restoredFromRevisionId?.toString(),
    generationMetadata: revision.generationMetadata
      ? {
        originalPrompt: revision.generationMetadata.originalPrompt,
        provider: revision.generationMetadata.provider,
        model: revision.generationMetadata.model,
      }
      : undefined,
  };
}

async function loadOwnedWorkflow(workflowId: string, userId: string): Promise<IWorkflowDocument> {
  const workflow = await Workflow.findOne({ _id: workflowId, userId });
  if (!workflow) throw new AppError(404, 'WORKFLOW_NOT_FOUND', 'Workflow not found');
  assertRevisionPointer(workflow);
  return workflow;
}

export async function createWorkflow(
  userId: string,
  input: CreateWorkflowInput,
): Promise<HydratedWorkflow> {
  validateWorkflowGraph(input.nodes, input.edges);

  return runInTransaction(async (session) => {
    const [workflow] = await Workflow.create([{
      userId,
      name: input.name,
      description: input.description,
      isGeneratedByAI: input.isGeneratedByAI,
    }], { session });

    const revision = await createRevision({
      workflowId: workflow._id,
      userId,
      revision: 1,
      parentRevisionId: null,
      source: input.isGeneratedByAI ? 'ai_generated' : 'manual',
      definition: {
        nodes: input.nodes,
        edges: input.edges,
        generationMetadata: input.generationMetadata,
      },
    }, session);

    workflow.currentRevisionId = revision._id;
    workflow.currentRevision = 1;
    await workflow.save({ session });
    return hydrateWorkflow(workflow, revision);
  });
}

export async function getWorkflowById(
  workflowId: string,
  userId: string,
): Promise<HydratedWorkflow> {
  const workflow = await Workflow.findOne({ _id: workflowId, userId });
  if (!workflow) throw new AppError(404, 'WORKFLOW_NOT_FOUND', 'Workflow not found');
  const revision = await loadOwnedCurrentRevision(workflow, userId);
  return hydrateWorkflow(workflow, revision);
}

export async function getWorkflowAiPromptContext(
  workflowId: string,
  userId: string,
): Promise<WorkflowAiPromptContext> {
  const workflow = await loadOwnedWorkflow(workflowId, userId);
  const currentRevision = await loadOwnedCurrentRevision(workflow, userId);
  return resolveWorkflowAiPromptLineage(
    toAiLineageRevision(currentRevision),
    async (revisionId) => {
      const revision = await WorkflowRevision.findOne({
        _id: revisionId,
        workflowId: workflow._id,
        userId,
      });
      if (!revision) return null;
      verifyWorkflowRevisionIntegrity(revision);
      return toAiLineageRevision(revision);
    },
  );
}

export async function assertWorkflowRevisionForAiGeneration(
  workflowId: string,
  userId: string,
  expectedRevision: number,
): Promise<void> {
  const workflow = await loadOwnedWorkflow(workflowId, userId);
  if (workflow.currentRevision !== expectedRevision) {
    throw new AppError(
      409,
      'WORKFLOW_REVISION_CONFLICT',
      `Workflow revision conflict: expected ${expectedRevision}, current ${workflow.currentRevision}`,
    );
  }
}

export async function createAiGeneratedWorkflowRevision(
  workflowId: string,
  userId: string,
  expectedRevision: number,
  generated: GeneratedWorkflow,
): Promise<HydratedWorkflow> {
  try {
    return await runInTransaction(async (session) => {
      const workflow = await Workflow.findOne({ _id: workflowId, userId }).session(session);
      if (!workflow) throw new AppError(404, 'WORKFLOW_NOT_FOUND', 'Workflow not found');
      assertRevisionPointer(workflow);
      if (workflow.currentRevision !== expectedRevision) {
        throw new AppError(
          409,
          'WORKFLOW_REVISION_CONFLICT',
          `Workflow revision conflict: expected ${expectedRevision}, current ${workflow.currentRevision}`,
        );
      }

      const currentRevision = await loadOwnedCurrentRevision(workflow, userId, session);
      const graph = normalizeAndValidateWorkflowGraph(generated.nodes, generated.edges);
      const generationMetadata = toHashableMetadata(generated.generationMetadata);
      if (!generationMetadata?.originalPrompt?.trim()) {
        throw new AppError(422, 'AI_GENERATION_METADATA_INVALID', 'AI generation did not produce trustworthy prompt metadata');
      }
      const nextRevision = workflow.currentRevision + 1;
      const revision = await createRevision({
        workflowId: workflow._id,
        userId,
        revision: nextRevision,
        parentRevisionId: currentRevision._id,
        source: 'ai_generated',
        definition: { ...graph, generationMetadata },
      }, session);

      const rootUpdates: Record<string, unknown> = {
        name: generated.name,
        currentRevision: nextRevision,
        currentRevisionId: revision._id,
        isGeneratedByAI: true,
      };
      if (generated.description !== undefined) rootUpdates.description = generated.description;
      const pointerUpdate = await Workflow.updateOne(
        {
          _id: workflow._id,
          userId,
          currentRevision: expectedRevision,
          currentRevisionId: currentRevision._id,
        },
        { $set: rootUpdates },
        { session, runValidators: true },
      );
      if (pointerUpdate.matchedCount !== 1) {
        throw new AppError(409, 'WORKFLOW_REVISION_CONFLICT', 'Workflow changed while AI generation was completing');
      }

      const updatedWorkflow = await Workflow.findOne({ _id: workflow._id, userId }).session(session);
      if (!updatedWorkflow) throw new AppError(404, 'WORKFLOW_NOT_FOUND', 'Workflow not found');
      return hydrateWorkflow(updatedWorkflow, revision);
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new AppError(409, 'WORKFLOW_REVISION_CONFLICT', 'Workflow changed while AI generation was completing');
    }
    throw error;
  }
}

export async function listWorkflowRevisions(
  workflowId: string,
  userId: string,
  query: WorkflowRevisionHistoryQuery,
): Promise<WorkflowRevisionHistoryPage> {
  const workflow = await loadOwnedWorkflow(workflowId, userId);
  const revisionMatch: Record<string, unknown> = {
    workflowId: workflow._id,
    userId,
  };
  if (query.beforeRevision !== undefined) {
    revisionMatch.revision = { $lt: query.beforeRevision };
  }

  const rows = await WorkflowRevision.aggregate<{
    _id: Types.ObjectId;
    revision: number;
    parentRevisionId: Types.ObjectId | null;
    source: WorkflowRevisionSource;
    definitionHash: string;
    restoredFromRevisionId?: Types.ObjectId;
    restoredFromRevision?: number;
    createdAt: Date;
    nodeCount: number;
    edgeCount: number;
  }>([
    { $match: revisionMatch },
    { $sort: { revision: -1 } },
    { $limit: query.limit + 1 },
    {
      $lookup: {
        from: WorkflowRevision.collection.name,
        let: {
          restoredRevisionId: '$restoredFromRevisionId',
          historyWorkflowId: '$workflowId',
          historyUserId: '$userId',
        },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$_id', '$$restoredRevisionId'] },
                  { $eq: ['$workflowId', '$$historyWorkflowId'] },
                  { $eq: ['$userId', '$$historyUserId'] },
                ],
              },
            },
          },
          { $project: { _id: 0, revision: 1 } },
        ],
        as: 'restoredFromRevisionDocument',
      },
    },
    {
      $project: {
        revision: 1,
        parentRevisionId: 1,
        source: 1,
        definitionHash: 1,
        restoredFromRevisionId: 1,
        restoredFromRevision: { $arrayElemAt: ['$restoredFromRevisionDocument.revision', 0] },
        createdAt: 1,
        nodeCount: { $size: '$nodes' },
        edgeCount: { $size: '$edges' },
      },
    },
  ]);

  const hasMore = rows.length > query.limit;
  const pageRows = rows.slice(0, query.limit);
  return {
    revisions: pageRows.map((row) => ({
      id: row._id.toString(),
      revision: row.revision,
      parentRevisionId: row.parentRevisionId?.toString() ?? null,
      source: row.source,
      definitionHash: row.definitionHash,
      restoredFromRevisionId: row.restoredFromRevisionId?.toString(),
      restoredFromRevision: row.restoredFromRevision,
      createdAt: row.createdAt,
      nodeCount: row.nodeCount,
      edgeCount: row.edgeCount,
    })),
    nextBeforeRevision: hasMore && pageRows.length > 0
      ? pageRows[pageRows.length - 1].revision
      : null,
  };
}

export async function getWorkflowRevision(
  workflowId: string,
  userId: string,
  revisionNumber: number,
): Promise<WorkflowRevisionDetail> {
  const workflow = await loadOwnedWorkflow(workflowId, userId);
  const revision = await WorkflowRevision.findOne({
    workflowId: workflow._id,
    userId,
    revision: revisionNumber,
  });
  if (!revision) {
    throw new AppError(404, 'WORKFLOW_REVISION_NOT_FOUND', 'Workflow revision not found');
  }
  verifyWorkflowRevisionIntegrity(revision);
  return serializeRevision(revision);
}

export async function compareWorkflowRevisions(
  workflowId: string,
  userId: string,
  fromRevisionNumber: number,
  toRevisionNumber: number,
): Promise<WorkflowRevisionComparison> {
  const workflow = await loadOwnedWorkflow(workflowId, userId);
  const loadRevision = (revision: number) => WorkflowRevision.findOne({
    workflowId: workflow._id,
    userId,
    revision,
  });

  const fromRevision = await loadRevision(fromRevisionNumber);
  if (!fromRevision) {
    throw new AppError(404, 'WORKFLOW_REVISION_NOT_FOUND', 'Workflow revision not found');
  }
  const toRevision = fromRevisionNumber === toRevisionNumber
    ? fromRevision
    : await loadRevision(toRevisionNumber);
  if (!toRevision) {
    throw new AppError(404, 'WORKFLOW_REVISION_NOT_FOUND', 'Workflow revision not found');
  }

  verifyWorkflowRevisionIntegrity(fromRevision);
  if (toRevision !== fromRevision) verifyWorkflowRevisionIntegrity(toRevision);

  return compareWorkflowRevisionDefinitions(
    workflow._id.toString(),
    fromRevision,
    toRevision,
  );
}

export async function restoreWorkflowRevision(
  workflowId: string,
  userId: string,
  revisionNumber: number,
  input: RestoreWorkflowRevisionInput,
): Promise<HydratedWorkflow> {
  try {
    return await runInTransaction(async (session) => {
      const workflow = await Workflow.findOne({ _id: workflowId, userId }).session(session);
      if (!workflow) throw new AppError(404, 'WORKFLOW_NOT_FOUND', 'Workflow not found');
      assertRevisionPointer(workflow);

      if (input.expectedRevision !== workflow.currentRevision) {
        throw new AppError(
          409,
          'WORKFLOW_REVISION_CONFLICT',
          `Workflow revision conflict: expected ${input.expectedRevision}, current ${workflow.currentRevision}`,
        );
      }
      if (revisionNumber === workflow.currentRevision) {
        throw new AppError(400, 'CANNOT_RESTORE_CURRENT_REVISION', 'The current revision cannot be restored');
      }

      // MongoDB transactions do not support parallel operations on one session.
      const currentRevision = await loadOwnedCurrentRevision(workflow, userId, session);
      const targetRevision = await WorkflowRevision.findOne({
        workflowId: workflow._id,
        userId,
        revision: revisionNumber,
      }).session(session);
      if (!targetRevision) {
        throw new AppError(404, 'WORKFLOW_REVISION_NOT_FOUND', 'Workflow revision not found');
      }

      const definition = verifyWorkflowRevisionIntegrity(targetRevision);

      const nextRevision = workflow.currentRevision + 1;
      const restoredRevision = await createRevision({
        workflowId: workflow._id,
        userId,
        revision: nextRevision,
        parentRevisionId: currentRevision._id,
        restoredFromRevisionId: targetRevision._id,
        source: 'restore',
        definition,
      }, session);

      const pointerUpdate = await Workflow.updateOne(
        {
          _id: workflow._id,
          userId,
          currentRevision: input.expectedRevision,
          currentRevisionId: currentRevision._id,
        },
        { $set: { currentRevision: nextRevision, currentRevisionId: restoredRevision._id } },
        { session, runValidators: true },
      );
      if (pointerUpdate.matchedCount !== 1) {
        throw new AppError(409, 'WORKFLOW_REVISION_CONFLICT', 'Workflow was updated while restoring');
      }

      const updatedWorkflow = await Workflow.findOne({ _id: workflow._id, userId }).session(session);
      if (!updatedWorkflow) throw new AppError(404, 'WORKFLOW_NOT_FOUND', 'Workflow not found');
      return hydrateWorkflow(updatedWorkflow, restoredRevision);
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new AppError(409, 'WORKFLOW_REVISION_CONFLICT', 'Workflow was updated while restoring');
    }
    throw error;
  }
}

export async function listWorkflows(userId: string): Promise<Array<Record<string, unknown>>> {
  return Workflow.aggregate([
    { $match: { userId } },
    { $sort: { updatedAt: -1 } },
    {
      $lookup: {
        from: WorkflowRevision.collection.name,
        let: {
          revisionId: '$currentRevisionId',
          workflowId: '$_id',
          workflowUserId: '$userId',
          revisionNumber: '$currentRevision',
        },
        pipeline: [{
          $match: {
            $expr: {
              $and: [
                { $eq: ['$_id', '$$revisionId'] },
                { $eq: ['$workflowId', '$$workflowId'] },
                { $eq: ['$userId', '$$workflowUserId'] },
                { $eq: ['$revision', '$$revisionNumber'] },
              ],
            },
          },
        }],
        as: 'currentRevisionDocument',
      },
    },
    { $set: { currentRevisionDocument: { $arrayElemAt: ['$currentRevisionDocument', 0] } } },
    {
      $project: {
        userId: 1,
        name: 1,
        description: 1,
        isGeneratedByAI: 1,
        createdAt: 1,
        updatedAt: 1,
        currentRevision: 1,
        currentRevisionId: 1,
        definitionHash: '$currentRevisionDocument.definitionHash',
        generationMetadata: { $ifNull: ['$currentRevisionDocument.generationMetadata', '$generationMetadata'] },
        nodeCount: { $size: { $ifNull: ['$currentRevisionDocument.nodes', { $ifNull: ['$nodes', []] }] } },
      },
    },
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
    .select('-nodes -edges -generationMetadata')  // Legacy definition data is never list-read as current truth.
    .lean<WorkflowListDocument[]>();

  return workflows;
}

type WorkflowListDocument = Pick<
  IWorkflow,
  'userId' | 'name' | 'description' | 'isGeneratedByAI' | 'createdAt' | 'updatedAt'
> & { _id: Types.ObjectId };

export async function updateWorkflow(
  workflowId: string,
  userId: string,
  input: UpdateWorkflowInput,
): Promise<HydratedWorkflow> {
  try {
    return await runInTransaction(async (session) => {
      const workflow = await Workflow.findOne({ _id: workflowId, userId }).session(session);
      if (!workflow) throw new AppError(404, 'WORKFLOW_NOT_FOUND', 'Workflow not found');
      assertRevisionPointer(workflow);

      if (input.expectedRevision !== workflow.currentRevision) {
        throw new AppError(
          409,
          'WORKFLOW_REVISION_CONFLICT',
          `Workflow revision conflict: expected ${input.expectedRevision}, current ${workflow.currentRevision}`,
        );
      }

      const currentRevision = await loadOwnedCurrentRevision(workflow, userId, session);
      const candidate = normalizeAndValidateWorkflowGraph(
        input.nodes ?? currentRevision.nodes,
        input.edges ?? currentRevision.edges,
      );
      const candidateMetadata = input.generationMetadata ?? toHashableMetadata(currentRevision.generationMetadata);
      const definition: WorkflowDefinition = {
        ...candidate,
        ...(candidateMetadata ? { generationMetadata: candidateMetadata } : {}),
      };
      const definitionHash = calculateDefinitionHash(definition);
      const rootUpdates: Record<string, unknown> = {};
      if (input.name !== undefined) rootUpdates.name = input.name;
      if (input.description !== undefined) rootUpdates.description = input.description;

      let activeRevision = currentRevision;
      if (definitionHash !== currentRevision.definitionHash) {
        const nextRevision = workflow.currentRevision + 1;
        activeRevision = await createRevision({
          workflowId: workflow._id,
          userId,
          revision: nextRevision,
          parentRevisionId: currentRevision._id,
          source: 'manual',
          definition,
        }, session);
        rootUpdates.currentRevisionId = activeRevision._id;
        rootUpdates.currentRevision = nextRevision;
      } else {
        rootUpdates.currentRevision = workflow.currentRevision;
      }

      const pointerUpdate = await Workflow.updateOne(
        {
          _id: workflow._id,
          userId,
          currentRevision: input.expectedRevision,
          currentRevisionId: currentRevision._id,
        },
        { $set: rootUpdates },
        { session, runValidators: true },
      );
      if (pointerUpdate.matchedCount !== 1) {
        throw new AppError(409, 'WORKFLOW_REVISION_CONFLICT', 'Workflow was updated by another save');
      }

      const updatedWorkflow = await Workflow.findOne({ _id: workflow._id, userId }).session(session);
      if (!updatedWorkflow) throw new AppError(404, 'WORKFLOW_NOT_FOUND', 'Workflow not found');
      return hydrateWorkflow(updatedWorkflow, activeRevision);
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new AppError(409, 'WORKFLOW_REVISION_CONFLICT', 'Workflow was updated by another save');
    }
    throw error;
  }
}

export async function deleteWorkflow(workflowId: string, userId: string): Promise<void> {
  await runInTransaction(async (session) => {
    const workflow = await Workflow.findOne({ _id: workflowId, userId }).session(session);
    if (!workflow) throw new AppError(404, 'WORKFLOW_NOT_FOUND', 'Workflow not found');

    await ExecutionRun.deleteMany({ workflowId: workflow._id, userId }).session(session);
    await WorkflowRevision.deleteMany({ workflowId: workflow._id, userId }).session(session);
    await Workflow.deleteOne({ _id: workflow._id, userId }).session(session);
    return true;
  });
}

export async function migrateWorkflowRevisions(
  observe: (event: MigrationEvent) => void = () => {},
  options: MigrationOptions = {},
): Promise<MigrationSummary> {
  const summary: MigrationSummary = {
    scanned: 0,
    wouldMigrate: 0,
    migrated: 0,
    alreadyMigrated: 0,
    skipped: 0,
    invalid: 0,
    integrityErrors: 0,
    failed: 0,
    failures: [],
  };
  if (!options.dryRun) {
    await (options.transactionCapabilityCheck ?? assertTransactionCapability)();
  }

  await forEachWorkflowBounded(async (candidate) => {
    summary.scanned += 1;
    const workflowId = candidate._id.toString();
    try {
      const hasRevisionId = Boolean(candidate.currentRevisionId);
      const hasRevisionNumber = candidate.currentRevision !== undefined && candidate.currentRevision !== null;
      if (hasRevisionId || hasRevisionNumber) {
        const issues = await inspectWorkflowRevisionState(candidate);
        if (issues.length > 0) {
          summary.integrityErrors += 1;
          const code = issues[0].code;
          summary.failures.push({ workflowId, code });
          observe({ workflowId, status: 'integrity_error', code });
        } else {
          summary.alreadyMigrated += 1;
          observe({ workflowId, status: 'already_migrated' });
        }
        return;
      }

      const unpointedRevision = await WorkflowRevision.findOne({
        workflowId: candidate._id,
        userId: candidate.userId,
      });
      if (unpointedRevision) {
        summary.integrityErrors += 1;
        summary.failures.push({ workflowId, code: 'AMBIGUOUS_UNPOINTERED_REVISIONS' });
        observe({ workflowId, status: 'integrity_error', code: 'AMBIGUOUS_UNPOINTERED_REVISIONS' });
        return;
      }

      let graph: ReturnType<typeof normalizeAndValidateWorkflowGraph>;
      try {
        graph = normalizeAndValidateWorkflowGraph(candidate.nodes ?? [], candidate.edges ?? []);
      } catch {
        summary.invalid += 1;
        summary.failures.push({ workflowId, code: 'INVALID_LEGACY_WORKFLOW' });
        observe({ workflowId, status: 'invalid', code: 'INVALID_LEGACY_WORKFLOW' });
        return;
      }
      const generationMetadata = candidate.isGeneratedByAI
        ? toHashableMetadata(candidate.generationMetadata)
        : undefined;
      calculateDefinitionHash({ ...graph, ...(generationMetadata ? { generationMetadata } : {}) });
      if (options.dryRun) {
        summary.wouldMigrate += 1;
        observe({ workflowId, status: 'would_migrate' });
        return;
      }

      const result = await runInTransaction(async (session) => {
        const workflow = await Workflow.findById(candidate._id).session(session);
        if (!workflow) return 'skipped' as const;
        const nowHasRevisionId = Boolean(workflow.currentRevisionId);
        const nowHasRevisionNumber = workflow.currentRevision !== undefined && workflow.currentRevision !== null;
        if (nowHasRevisionId && nowHasRevisionNumber) return 'already_migrated' as const;
        if (nowHasRevisionId !== nowHasRevisionNumber) {
          throw new AppError(409, 'WORKFLOW_MIGRATION_INTEGRITY_ERROR', 'Workflow has a partial revision pointer');
        }

        let transactionGraph: ReturnType<typeof normalizeAndValidateWorkflowGraph>;
        try {
          transactionGraph = normalizeAndValidateWorkflowGraph(workflow.nodes ?? [], workflow.edges ?? []);
        } catch {
          throw new AppError(422, 'WORKFLOW_MIGRATION_INVALID_LEGACY', 'Legacy workflow graph is invalid');
        }
        const transactionMetadata = workflow.isGeneratedByAI
          ? toHashableMetadata(workflow.generationMetadata)
          : undefined;

        const revision = await createRevision({
          workflowId: workflow._id,
          userId: workflow.userId,
          revision: 1,
          parentRevisionId: null,
          source: workflow.isGeneratedByAI ? 'ai_generated' : 'manual',
          definition: {
            ...transactionGraph,
            ...(transactionMetadata ? { generationMetadata: transactionMetadata } : {}),
          },
        }, session);
        const update = await Workflow.updateOne(
          {
            _id: workflow._id,
            $or: [{ currentRevisionId: { $exists: false } }, { currentRevisionId: null }],
          },
          { $set: { currentRevisionId: revision._id, currentRevision: 1 } },
          { session },
        );
        if (update.matchedCount !== 1) {
          throw new AppError(409, 'WORKFLOW_MIGRATION_CONFLICT', 'Workflow was migrated concurrently');
        }
        return 'migrated' as const;
      });

      if (result === 'migrated') {
        summary.migrated += 1;
        observe({ workflowId, status: 'migrated' });
      } else if (result === 'already_migrated') {
        summary.alreadyMigrated += 1;
        observe({ workflowId, status: 'already_migrated' });
      } else {
        summary.skipped += 1;
        observe({ workflowId, status: 'skipped' });
      }
    } catch (error) {
      if (isDuplicateKeyError(error) || (error instanceof AppError && error.code === 'WORKFLOW_MIGRATION_CONFLICT')) {
        const concurrent = await Workflow.findById(candidate._id);
        if (concurrent?.currentRevisionId && concurrent.currentRevision) {
          const issues = await inspectWorkflowRevisionState(concurrent);
          if (issues.length === 0) {
            summary.alreadyMigrated += 1;
            observe({ workflowId, status: 'already_migrated' });
            return;
          }
        }
        summary.integrityErrors += 1;
        summary.failures.push({ workflowId, code: 'WORKFLOW_MIGRATION_CONFLICT_INTEGRITY_ERROR' });
        observe({ workflowId, status: 'integrity_error', code: 'WORKFLOW_MIGRATION_CONFLICT_INTEGRITY_ERROR' });
        return;
      }
      if (error instanceof AppError && error.code === 'WORKFLOW_MIGRATION_INTEGRITY_ERROR') {
        summary.integrityErrors += 1;
        summary.failures.push({ workflowId, code: error.code });
        observe({ workflowId, status: 'integrity_error', code: error.code });
        return;
      }
      if (error instanceof AppError && error.code === 'WORKFLOW_MIGRATION_INVALID_LEGACY') {
        summary.invalid += 1;
        summary.failures.push({ workflowId, code: error.code });
        observe({ workflowId, status: 'invalid', code: error.code });
        return;
      }
      const code = error instanceof AppError ? error.code : 'MIGRATION_OPERATION_FAILED';
      summary.failed += 1;
      summary.failures.push({ workflowId, code });
      observe({ workflowId, status: 'failed', code });
    }
  }, options.batchSize);

  return summary;
}
