import { z } from 'zod';

// ── Node type enum ──────────────────────────────────────────

export const nodeTypeSchema = z.enum([
  'start', 'api_call', 'condition', 'transform', 'delay', 'output', 'end',
]);

// ── Per-type config schemas ─────────────────────────────────

const startConfigSchema = z.object({}).passthrough();

const apiCallConfigSchema = z.object({
  url: z.string().min(1),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE']),
  headers: z.record(z.string(), z.string()).default({}),
  body: z.string().optional(),
  timeout: z.number().int().min(100).max(30000).optional(),
});

const conditionConfigSchema = z.object({
  expression: z.string().min(1),
  trueTargetNodeId: z.string().optional(),
  falseTargetNodeId: z.string().optional(),
});

const transformConfigSchema = z.object({
  transformCode: z.string().min(1),
  description: z.string().optional(),
});

const delayConfigSchema = z.object({
  delayMs: z.number().int().min(0).max(300000),
});

const outputConfigSchema = z.object({
  logLevel: z.enum(['info', 'warn', 'error']),
  message: z.string().min(1),
});

const endConfigSchema = z.object({}).passthrough();

// ── Config schema (any valid config) ────────────────────────
// We validate the specific config shape in the refinement below,
// so here we accept any object.

const nodeConfigSchema = z.union([
  startConfigSchema,
  apiCallConfigSchema,
  conditionConfigSchema,
  transformConfigSchema,
  delayConfigSchema,
  outputConfigSchema,
  endConfigSchema,
]);

// ── Position ────────────────────────────────────────────────

const positionSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});

// ── Node ────────────────────────────────────────────────────

export const nodeSchema = z.object({
  id: z.string().min(1),
  type: nodeTypeSchema,
  label: z.string().min(1).max(100),
  position: positionSchema,
  config: z.union([z.record(z.unknown()), z.object({})]).default({}),
  description: z.string().optional(),
});

// ── Edge ────────────────────────────────────────────────────

export const edgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional(),
  conditionBranch: z.enum(['true', 'false']).optional(),
  label: z.string().optional(),
});

// ── Workflow (create request body) ──────────────────────────

export const createWorkflowSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().max(500).optional(),
  nodes: z.array(nodeSchema).default([]),
  edges: z.array(edgeSchema).default([]),
  isGeneratedByAI: z.boolean().default(false),
});

// ── Workflow (update request body) ──────────────────────────
// All fields optional — partial updates allowed

export const updateWorkflowSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  nodes: z.array(nodeSchema).optional(),
  edges: z.array(edgeSchema).optional(),
});

// ── Type exports ────────────────────────────────────────────

export type CreateWorkflowInput = z.infer<typeof createWorkflowSchema>;
export type UpdateWorkflowInput = z.infer<typeof updateWorkflowSchema>;

// ── Cross-field validation helpers ──────────────────────────

/**
 * Validates that the config shape matches the node type.
 * Called after Zod parsing on the individual fields.
 */
export function validateNodeConfig(
  type: string,
  config: Record<string, unknown>,
): { valid: boolean; error?: string } {
  const schemaMap: Record<string, z.ZodSchema> = {
    start: startConfigSchema,
    api_call: apiCallConfigSchema,
    condition: conditionConfigSchema,
    transform: transformConfigSchema,
    delay: delayConfigSchema,
    output: outputConfigSchema,
    end: endConfigSchema,
  };

  const schema = schemaMap[type];
  if (!schema) {
    return { valid: false, error: `Unknown node type: ${type}` };
  }

  const result = schema.safeParse(config);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    return { valid: false, error: `Invalid config for ${type}: ${issues.join(', ')}` };
  }

  return { valid: true };
}

/**
 * Validates that all edge source/target IDs reference existing node IDs.
 */
export function validateEdgeReferences(
  nodes: Array<{ id: string }>,
  edges: Array<{ source: string; target: string }>,
): { valid: boolean; errors: string[] } {
  const nodeIds = new Set(nodes.map((n) => n.id));
  const errors: string[] = [];

  for (const edge of edges) {
    if (!nodeIds.has(edge.source)) {
      errors.push(`Edge references nonexistent source node: ${edge.source}`);
    }
    if (!nodeIds.has(edge.target)) {
      errors.push(`Edge references nonexistent target node: ${edge.target}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validates that node IDs are unique within the workflow.
 */
export function validateUniqueNodeIds(
  nodes: Array<{ id: string }>,
): { valid: boolean; duplicates: string[] } {
  const seen = new Set<string>();
  const duplicates: string[] = [];

  for (const node of nodes) {
    if (seen.has(node.id)) {
      duplicates.push(node.id);
    }
    seen.add(node.id);
  }

  return { valid: duplicates.length === 0, duplicates };
}

/**
 * Detects cycles in the edge graph using DFS.
 * Returns true if the graph is a valid DAG (no cycles).
 */
export function isValidDAG(
  nodes: Array<{ id: string }>,
  edges: Array<{ source: string; target: string }>,
): boolean {
  const adjacency = new Map<string, string[]>();
  for (const node of nodes) {
    adjacency.set(node.id, []);
  }
  for (const edge of edges) {
    adjacency.get(edge.source)?.push(edge.target);
  }

  const WHITE = 0; // unvisited
  const GRAY = 1;  // in current DFS path
  const BLACK = 2; // fully processed

  const color = new Map<string, number>();
  for (const node of nodes) {
    color.set(node.id, WHITE);
  }

  function dfs(nodeId: string): boolean {
    color.set(nodeId, GRAY);

    for (const neighbor of adjacency.get(nodeId) || []) {
      const neighborColor = color.get(neighbor);
      if (neighborColor === GRAY) return false; // cycle detected
      if (neighborColor === WHITE && !dfs(neighbor)) return false;
    }

    color.set(nodeId, BLACK);
    return true;
  }

  for (const node of nodes) {
    if (color.get(node.id) === WHITE) {
      if (!dfs(node.id)) return false;
    }
  }

  return true;
}
