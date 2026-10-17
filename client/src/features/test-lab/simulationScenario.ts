import type {
  SimulationNode,
  SimulationScenario,
  TestLabAssertionDraft,
} from '@/types/simulation';

export const MOCKABLE_TYPES = new Set(['api_call', 'transform', 'condition']);
const SIMPLE_PATH = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/;
const FORBIDDEN_PATH_PARTS = new Set(['__proto__', 'constructor', 'prototype']);
const MAX_BYTES = 50_000;

export function initialSimulationFixtures(nodes: SimulationNode[]): Record<string, string> {
  return Object.fromEntries(nodes.flatMap((node) => {
    if (node.type === 'api_call') {
      return [[node.id, JSON.stringify({ status: 200, data: [], headers: {} }, null, 2)]];
    }
    if (node.type === 'transform') {
      return [[node.id, JSON.stringify({ data: null }, null, 2)]];
    }
    return [];
  }));
}

export function initialConditionBranches(nodes: SimulationNode[]): Record<string, 'true' | 'false'> {
  return Object.fromEntries(
    nodes.filter((node) => node.type === 'condition').map((node) => [node.id, 'true']),
  );
}

function jsonObject(source: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error(`${label}: enter a valid JSON object.`);
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error(`${label}: the mock must be a JSON object, not an array or primitive.`);
  }
  return parsed as Record<string, unknown>;
}

function safePath(value: string): boolean {
  return SIMPLE_PATH.test(value) && value.split('.').every((part) => !FORBIDDEN_PATH_PARTS.has(part));
}

export function buildSimulationScenario({
  revision,
  nodes,
  fixtures,
  conditionBranches,
  expectedBranches,
  assertions,
}: {
  revision: number;
  nodes: SimulationNode[];
  fixtures: Record<string, string>;
  conditionBranches: Record<string, 'true' | 'false'>;
  expectedBranches: Record<string, '' | 'true' | 'false'>;
  assertions: TestLabAssertionDraft[];
}): SimulationScenario {
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new Error('Save this workflow before running the Test Lab.');
  }

  const knownNodes = new Set(nodes.map((node) => node.id));
  const mocks: SimulationScenario['mocks'] = {};
  const branches: SimulationScenario['expectedBranches'] = {};

  for (const node of nodes) {
    if (node.type === 'api_call' || node.type === 'transform') {
      const mock = jsonObject(fixtures[node.id] ?? '', node.label);
      if (node.type === 'api_call') {
        if (!Number.isInteger(mock.status) || (mock.status as number) < 100 || (mock.status as number) > 599
          || !Object.prototype.hasOwnProperty.call(mock, 'data')) {
          throw new Error(`${node.label}: API mocks need an HTTP status (100–599) and a data field.`);
        }
        if (mock.headers !== undefined && (!mock.headers || Array.isArray(mock.headers) || typeof mock.headers !== 'object')) {
          throw new Error(`${node.label}: headers must be a JSON object.`);
        }
      }
      mocks[node.id] = mock;
    } else if (node.type === 'condition') {
      const branchTaken = conditionBranches[node.id];
      if (branchTaken !== 'true' && branchTaken !== 'false') {
        throw new Error(`${node.label}: choose a simulated condition branch.`);
      }
      mocks[node.id] = { branchTaken };
      const expected = expectedBranches[node.id];
      if (expected === 'true' || expected === 'false') branches[node.id] = expected;
    }
  }

  if (assertions.length > 100) throw new Error('The Test Lab supports up to 100 assertions.');
  const checks = assertions.map(({ nodeId, path, expectedJson }, index) => {
    if (!knownNodes.has(nodeId)) {
      throw new Error(`Assertion ${index + 1}: choose a workflow node.`);
    }
    const trimmed = path.trim();
    if (trimmed && !safePath(trimmed)) {
      throw new Error(`Assertion ${index + 1}: enter a simple field path, such as data.count.`);
    }
    let equals: unknown;
    try {
      equals = JSON.parse(expectedJson);
    } catch {
      throw new Error(`Assertion ${index + 1}: expected value must be valid JSON (e.g., 200, true, or "ok").`);
    }
    return { nodeId, ...(trimmed ? { path: trimmed } : {}), equals };
  });
  const scenario: SimulationScenario = { expectedRevision: revision, mocks, assertions: checks, expectedBranches: branches };
  if (new TextEncoder().encode(JSON.stringify(scenario)).length > MAX_BYTES) {
    throw new Error('Simulation fixtures and assertions must stay below 50 KB.');
  }
  return scenario;
}
