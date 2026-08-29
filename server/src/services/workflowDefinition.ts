import { createHash } from 'crypto';
import { AppError } from '../middleware/errorHandler.middleware';
import {
  type CreateWorkflowInput,
  workflowGraphSchema,
  validateNodeConfig,
  validateEdgeReferences,
  validateUniqueNodeIds,
  isValidDAG,
} from '../validators/workflow.validator';

export type WorkflowNodes = CreateWorkflowInput['nodes'];
export type WorkflowEdges = CreateWorkflowInput['edges'];
export type WorkflowGenerationMetadata = Omit<
  NonNullable<CreateWorkflowInput['generationMetadata']>,
  'generatedAt'
> & { generatedAt: string | Date };

export interface WorkflowDefinition {
  nodes: WorkflowNodes;
  edges: WorkflowEdges;
  generationMetadata?: WorkflowGenerationMetadata;
}

interface MongooseObjectConvertible {
  toObject(options?: Record<string, unknown>): unknown;
}

function toLogicalObject(value: unknown): Record<string, unknown> {
  const converted = value && typeof value === 'object'
    && typeof (value as Partial<MongooseObjectConvertible>).toObject === 'function'
    ? (value as MongooseObjectConvertible).toObject({
        depopulate: true,
        flattenMaps: true,
        versionKey: false,
      })
    : value;

  if (!converted || typeof converted !== 'object' || Array.isArray(converted)) {
    throw new TypeError('Workflow generation metadata must be an object');
  }
  return converted as Record<string, unknown>;
}

/** Convert metadata into its persisted logical shape, excluding ODM document internals. */
export function normalizeWorkflowGenerationMetadata(
  metadata: unknown,
): WorkflowGenerationMetadata | undefined {
  if (metadata === undefined || metadata === null) return undefined;

  const value = toLogicalObject(metadata);
  const capabilityCoverage = value.capabilityCoverage === undefined
    ? undefined
    : toLogicalObject(value.capabilityCoverage);

  return {
    originalPrompt: value.originalPrompt as string,
    generatedAt: value.generatedAt as string | Date,
    ...(value.provider !== undefined ? { provider: value.provider as string } : {}),
    ...(value.model !== undefined ? { model: value.model as string } : {}),
    ...(capabilityCoverage
      ? {
          capabilityCoverage: {
            requestedCapabilities: capabilityCoverage.requestedCapabilities as string[],
            implementedCapabilities: capabilityCoverage.implementedCapabilities as string[],
            missingCapabilities: capabilityCoverage.missingCapabilities as string[],
            unsupportedCapabilities: capabilityCoverage.unsupportedCapabilities as string[],
            coverage: capabilityCoverage.coverage as number,
            isComplete: capabilityCoverage.isComplete as boolean,
          },
        }
      : {}),
  };
}

function canonicalizeValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalizeValue);
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        const child = (value as Record<string, unknown>)[key];
        if (child !== undefined) result[key] = canonicalizeValue(child);
        return result;
      }, {});
  }
  return value;
}

function stableDefinitionItemSort(left: Record<string, unknown>, right: Record<string, unknown>): number {
  const idComparison = String(left.id ?? '').localeCompare(String(right.id ?? ''));
  if (idComparison !== 0) return idComparison;
  return JSON.stringify(canonicalizeValue(left)).localeCompare(JSON.stringify(canonicalizeValue(right)));
}

export function canonicalizeWorkflowDefinition(definition: WorkflowDefinition): Record<string, unknown> {
  const nodes = definition.nodes
    .map((node) => canonicalizeValue(node) as Record<string, unknown>)
    .sort(stableDefinitionItemSort);
  const edges = definition.edges
    .map((edge) => canonicalizeValue(edge) as Record<string, unknown>)
    .sort(stableDefinitionItemSort);
  const normalizedMetadata = normalizeWorkflowGenerationMetadata(definition.generationMetadata);
  const generationMetadata = normalizedMetadata
    ? {
        ...normalizedMetadata,
        generatedAt: new Date(normalizedMetadata.generatedAt).toISOString(),
      }
    : undefined;

  return canonicalizeValue({
    nodes,
    edges,
    ...(generationMetadata ? { generationMetadata } : {}),
  }) as Record<string, unknown>;
}

export function calculateDefinitionHash(definition: WorkflowDefinition): string {
  const canonicalJson = JSON.stringify(canonicalizeWorkflowDefinition(definition));
  return createHash('sha256').update(canonicalJson).digest('hex');
}

export function validateWorkflowGraph(nodes: WorkflowNodes, edges: WorkflowEdges): void {
  const uniqueCheck = validateUniqueNodeIds(nodes);
  if (!uniqueCheck.valid) {
    throw new AppError(400, 'DUPLICATE_NODE_IDS', `Duplicate node IDs: ${uniqueCheck.duplicates.join(', ')}`);
  }

  const referenceCheck = validateEdgeReferences(nodes, edges);
  if (!referenceCheck.valid) {
    throw new AppError(400, 'INVALID_EDGE_REFERENCES', referenceCheck.errors.join('; '));
  }

  if (!isValidDAG(nodes, edges)) {
    throw new AppError(400, 'CYCLE_DETECTED', 'Workflow contains a cycle. Edges must form a DAG.');
  }

  for (const node of nodes) {
    const configCheck = validateNodeConfig(node.type, node.config as Record<string, unknown>);
    if (!configCheck.valid) {
      throw new AppError(400, 'INVALID_NODE_CONFIG', configCheck.error!);
    }
  }
}

export function normalizeAndValidateWorkflowGraph(
  nodes: unknown,
  edges: unknown,
): { nodes: WorkflowNodes; edges: WorkflowEdges } {
  const parsed = workflowGraphSchema.safeParse({ nodes, edges });
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(', ');
    throw new AppError(400, 'INVALID_WORKFLOW_DEFINITION', message);
  }
  validateWorkflowGraph(parsed.data.nodes, parsed.data.edges);
  return parsed.data;
}
