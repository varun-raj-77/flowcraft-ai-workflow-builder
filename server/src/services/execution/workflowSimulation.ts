import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { AppError } from '../../middleware/errorHandler.middleware';
import { redactSecrets, redactText } from '../../utils/redact';
import { Workflow } from '../../models/Workflow.model';
import { WorkflowRevision } from '../../models/WorkflowRevision.model';
import { normalizeAndValidateWorkflowGraph, type WorkflowDefinition } from '../workflowDefinition';
import { verifyWorkflowRevisionIntegrity } from '../workflowRevisionIntegrity';
import { findSkippedNodes, topologicalSort } from './dagUtils';

const mockValue = z.record(z.unknown());
const assertionSchema = z.object({
  nodeId: z.string().min(1),
  path: z.string().max(160).optional(),
  equals: z.unknown(),
}).strict();

export const simulationScenarioSchema = z.object({
  expectedRevision: z.number().int().min(1),
  mocks: z.record(mockValue).default({}),
  assertions: z.array(assertionSchema).max(100).default([]),
  expectedBranches: z.record(z.enum(['true', 'false'])).default({}),
}).strict();

export type SimulationScenario = z.infer<typeof simulationScenarioSchema>;
export interface SimulationStep {
  nodeId: string;
  nodeType: string;
  status: 'simulated' | 'mocked' | 'skipped' | 'failed';
  output?: Record<string, unknown>;
  error?: string;
}
export interface SimulationAssertion {
  nodeId: string;
  path?: string;
  passed: boolean;
  message: string;
}
export interface SimulationResult {
  status: 'passed' | 'failed';
  steps: SimulationStep[];
  assertions: SimulationAssertion[];
  /** The revision and hash were verified before a production simulation. */
  provenance?: { workflowRevision: number; definitionHash: string };
}

const forbiddenKeys = new Set(['__proto__', 'constructor', 'prototype']);
const simplePath = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/;
const isSafePath = (path: string): boolean => simplePath.test(path)
  && path.split('.').every((part) => !forbiddenKeys.has(part));
const MAX_SCENARIO_BYTES = 50_000;
const MAX_NODES = 80;
const MAX_EDGES = 160;

function sanitize(value: Record<string, unknown>): Record<string, unknown> {
  return redactSecrets(value) as Record<string, unknown>;
}

function readPath(value: unknown, path: string): unknown {
  if (!isSafePath(path)) return undefined;
  let current: unknown = value;
  for (const part of path.split('.')) {
    if (forbiddenKeys.has(part) || current === null || typeof current !== 'object'
      || !Object.prototype.hasOwnProperty.call(current, part)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** Resolve only data paths. No template functions, evaluation or prototype traversal. */
function safeTemplate(template: string, outputs: Map<string, Record<string, unknown>>): string {
  return template.replace(/\{\{([^{}]{1,160})\}\}/g, (_match, raw: string) => {
    const path = raw.trim();
    if (!isSafePath(path)) return '';
    const [root, ...rest] = path.split('.');
    const values = Array.from(outputs.values());
    const last = values[values.length - 1];
    const source = root === 'prev' ? last : outputs.get(root);
    const value = rest.length ? readPath(source, rest.join('.')) : source;
    if (value === null || value === undefined) return '';
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  });
}

function checkScenario(definition: WorkflowDefinition, input: unknown): SimulationScenario {
  const parsed = simulationScenarioSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError(400, 'INVALID_SIMULATION_SCENARIO', 'Invalid simulation inputs or assertions');
  }
  const scenario = parsed.data;
  let serialized: string;
  try { serialized = JSON.stringify(scenario); }
  catch { throw new AppError(400, 'INVALID_SIMULATION_SCENARIO', 'Simulation inputs must be JSON'); }
  if (!serialized || Buffer.byteLength(serialized, 'utf8') > MAX_SCENARIO_BYTES) {
    throw new AppError(413, 'SIMULATION_TOO_LARGE', 'Simulation inputs exceed 50 KB');
  }
  const ids = new Map(definition.nodes.map((node) => [node.id, node.type]));
  for (const [id, mock] of Object.entries(scenario.mocks)) {
    if (!ids.has(id) || !['api_call', 'transform', 'condition'].includes(ids.get(id)!)) {
      throw new AppError(400, 'INVALID_SIMULATION_MOCK', 'Mocks can only target existing API, Transform, or Condition nodes');
    }
    if (ids.get(id) === 'condition' && mock.branchTaken !== 'true' && mock.branchTaken !== 'false') {
      throw new AppError(400, 'INVALID_SIMULATION_MOCK', 'Condition mocks must declare branchTaken as true or false');
    }
    if (ids.get(id) === 'api_call' && (typeof mock.status !== 'number' || !Number.isInteger(mock.status) || mock.status < 100 || (mock.status as number) > 599 || !Object.prototype.hasOwnProperty.call(mock, 'data'))) {
      throw new AppError(400, 'INVALID_SIMULATION_MOCK', 'API mocks must include HTTP status and data');
    }
  }
  for (const assertion of scenario.assertions) {
    if (!ids.has(assertion.nodeId) || (assertion.path !== undefined && !isSafePath(assertion.path))) {
      throw new AppError(400, 'INVALID_SIMULATION_ASSERTION', 'Assertions must reference existing nodes and simple property paths');
    }
  }
  for (const id of Object.keys(scenario.expectedBranches)) {
    if (ids.get(id) !== 'condition') {
      throw new AppError(400, 'INVALID_SIMULATION_ASSERTION', 'Branch assertions must reference Condition nodes');
    }
  }
  return scenario;
}

export function simulateDefinition(definition: WorkflowDefinition, rawScenario: unknown): SimulationResult {
  const graph = normalizeAndValidateWorkflowGraph(definition.nodes, definition.edges);
  if (graph.nodes.length > MAX_NODES || graph.edges.length > MAX_EDGES) {
    throw new AppError(413, 'SIMULATION_GRAPH_TOO_LARGE', 'Simulation supports up to 80 nodes and 160 edges');
  }
  const scenario = checkScenario(definition, rawScenario);
  const order = topologicalSort(graph.nodes, graph.edges);
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const outputs = new Map<string, Record<string, unknown>>();
  const skipped = new Set<string>();
  const steps: SimulationStep[] = [];
  let failed = false;

  for (const id of order) {
    const node = nodes.get(id)!;
    if (failed || skipped.has(id)) {
      steps.push({ nodeId: id, nodeType: node.type, status: 'skipped' });
      continue;
    }
    const mock = Object.prototype.hasOwnProperty.call(scenario.mocks, id) ? scenario.mocks[id] : undefined;
    let output: Record<string, unknown>;
    const config = node.config as Record<string, unknown>;
    let status: SimulationStep['status'] = 'simulated';
    switch (node.type) {
      case 'start':
      case 'end':
        output = {};
        break;
      case 'delay':
        // Simulated logical delay: deliberately never calls setTimeout.
        output = { delayedMs: config.delayMs };
        break;
      case 'output':
        // Deliberately does not invoke the production executor (it logs to stdout).
        output = {
          logLevel: config.logLevel,
          message: redactText(safeTemplate(String(config.message), outputs)),
        };
        break;
      case 'api_call':
      case 'transform':
      case 'condition':
        // NEVER invoke getExecutor(), fetch(), new Function(), or user code.
        if (!mock) {
          failed = true;
          steps.push({ nodeId: id, nodeType: node.type, status: 'failed', error: 'SIMULATION_MOCK_REQUIRED' });
          continue;
        }
        if (node.type === 'api_call') {
          output = { status: mock.status, data: mock.data, headers: mock.headers ?? {} };
        } else if (node.type === 'condition') {
          output = { result: mock.branchTaken === 'true', branchTaken: mock.branchTaken };
        } else {
          output = mock;
        }
        status = 'mocked';
        break;
      default:
        // Fail closed when future node types are added.
        failed = true;
        steps.push({ nodeId: id, nodeType: node.type, status: 'failed', error: 'UNSUPPORTED_SIMULATION_NODE' });
        continue;
    }
    // Do not let credential-like fields enter the interpolation context or test result.
    const safeOutput = sanitize(output);
    outputs.set(id, safeOutput);
    steps.push({ nodeId: id, nodeType: node.type, status, output: safeOutput });
    if (node.type === 'condition') {
      for (const skippedId of findSkippedNodes(id, output.branchTaken as 'true' | 'false', graph.edges, skipped)) {
        skipped.add(skippedId);
      }
    }
  }

  const assertions: SimulationAssertion[] = scenario.assertions.map(({ nodeId, path, equals }) => {
    const output = outputs.get(nodeId);
    const actual = path ? readPath(output, path) : output;
    const passed = output !== undefined && isDeepStrictEqual(actual, equals);
    return { nodeId, ...(path ? { path } : {}), passed, message: passed ? 'Expected value matched' : 'Expected value did not match' };
  });
  for (const [nodeId, branch] of Object.entries(scenario.expectedBranches)) {
    const actual = outputs.get(nodeId)?.branchTaken;
    const passed = actual === branch;
    assertions.push({ nodeId, path: 'branchTaken', passed, message: passed ? 'Expected branch selected' : 'Expected branch not selected' });
  }

  return {
    status: failed || assertions.some((a) => !a.passed) ? 'failed' : 'passed',
    steps,
    assertions,
  };
}

/** Owner-authorized, read-only and strictly revision-pinned simulation. */
export async function simulateOwnedWorkflow(workflowId: string, userId: string, rawScenario: unknown): Promise<SimulationResult> {
  // Validate size and shape before looking up owner data or performing any work.
  const parsed = simulationScenarioSchema.safeParse(rawScenario);
  if (!parsed.success) throw new AppError(400, 'INVALID_SIMULATION_SCENARIO', 'Invalid simulation inputs or assertions');
  const workflow = await Workflow.findOne({ _id: workflowId, userId });
  if (!workflow) throw new AppError(404, 'WORKFLOW_NOT_FOUND', 'Workflow not found');
  if (workflow.currentRevision !== parsed.data.expectedRevision) {
    throw new AppError(409, 'WORKFLOW_REVISION_CONFLICT', 'The workflow revision changed. Refresh before simulating.');
  }
  if (!workflow.currentRevisionId) throw new AppError(409, 'WORKFLOW_MIGRATION_REQUIRED', 'Workflow revision is unavailable');
  const revision = await WorkflowRevision.findOne({
    _id: workflow.currentRevisionId,
    workflowId: workflow._id,
    userId,
    revision: workflow.currentRevision,
  });
  if (!revision) throw new AppError(409, 'WORKFLOW_REVISION_MISSING', 'The pinned revision is unavailable');
  const verifiedDefinition = verifyWorkflowRevisionIntegrity(revision);
  const result = simulateDefinition(verifiedDefinition, parsed.data);
  return {
    ...result,
    provenance: { workflowRevision: revision.revision, definitionHash: revision.definitionHash },
  };
}
