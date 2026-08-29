import type { IWorkflowRevisionDocument, WorkflowRevisionSource } from '../models/WorkflowRevision.model';
import { redactSecrets } from '../utils/redact';

type WorkflowNode = IWorkflowRevisionDocument['nodes'][number];
type WorkflowEdge = IWorkflowRevisionDocument['edges'][number];

export type WorkflowChangeCategory = 'runtime' | 'presentation' | 'layout';

export interface WorkflowFieldChange {
  path: string;
  category: WorkflowChangeCategory;
  beforePresent: boolean;
  afterPresent: boolean;
  before?: unknown;
  after?: unknown;
}

export interface WorkflowComparisonRevision {
  id: string;
  revision: number;
  source: WorkflowRevisionSource;
  definitionHash: string;
  createdAt: Date;
}

export interface WorkflowRevisionComparison {
  workflowId: string;
  from: WorkflowComparisonRevision;
  to: WorkflowComparisonRevision;
  hasChanges: boolean;
  summary: {
    totalChanges: number;
    nodes: { added: number; removed: number; modified: number };
    edges: { added: number; removed: number; modified: number };
  };
  nodes: {
    added: Array<{ nodeId: string; node: WorkflowNode }>;
    removed: Array<{ nodeId: string; node: WorkflowNode }>;
    modified: Array<{
      nodeId: string;
      before: WorkflowNode;
      after: WorkflowNode;
      changes: WorkflowFieldChange[];
      changesTruncated: boolean;
    }>;
  };
  edges: {
    added: Array<{ edgeKey: string; edge: WorkflowEdge }>;
    removed: Array<{ edgeKey: string; edge: WorkflowEdge }>;
    modified: Array<{
      edgeKey: string;
      before: WorkflowEdge;
      after: WorkflowEdge;
      changes: WorkflowFieldChange[];
      changesTruncated: boolean;
    }>;
  };
  graph: {
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
  };
}

const MAX_FIELD_CHANGES_PER_ENTITY = 100;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function redact<T>(value: T): T {
  return redactSecrets(value) as T;
}

function fieldChange(
  path: string,
  category: WorkflowChangeCategory,
  before: unknown,
  after: unknown,
  beforePresent = true,
  afterPresent = true,
): WorkflowFieldChange {
  return {
    path,
    category,
    beforePresent,
    afterPresent,
    ...(beforePresent ? { before: redact(before) } : {}),
    ...(afterPresent ? { after: redact(after) } : {}),
  };
}

function collectValueChanges(
  before: unknown,
  after: unknown,
  path: string,
  category: WorkflowChangeCategory,
  output: WorkflowFieldChange[],
): void {
  if (valuesEqual(before, after) || output.length > MAX_FIELD_CHANGES_PER_ENTITY) return;

  const beforeObject = before && typeof before === 'object' && !Array.isArray(before);
  const afterObject = after && typeof after === 'object' && !Array.isArray(after);
  if (beforeObject && afterObject) {
    const beforeRecord = before as Record<string, unknown>;
    const afterRecord = after as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)])]
      .sort((left, right) => left.localeCompare(right));
    for (const key of keys) {
      if (output.length > MAX_FIELD_CHANGES_PER_ENTITY) return;
      const beforePresent = Object.prototype.hasOwnProperty.call(beforeRecord, key);
      const afterPresent = Object.prototype.hasOwnProperty.call(afterRecord, key);
      const childPath = `${path}.${key}`;
      if (!beforePresent || !afterPresent) {
        output.push(fieldChange(
          childPath,
          category,
          beforeRecord[key],
          afterRecord[key],
          beforePresent,
          afterPresent,
        ));
      } else {
        collectValueChanges(beforeRecord[key], afterRecord[key], childPath, category, output);
      }
    }
    return;
  }

  output.push(fieldChange(path, category, before, after));
}

function compareNodes(before: WorkflowNode, after: WorkflowNode): WorkflowFieldChange[] {
  const changes: WorkflowFieldChange[] = [];
  if (before.type !== after.type) {
    changes.push(fieldChange('type', 'runtime', before.type, after.type));
  }
  if (before.label !== after.label) {
    changes.push(fieldChange('label', 'presentation', before.label, after.label));
  }
  if (before.description !== after.description) {
    changes.push(fieldChange(
      'description',
      'presentation',
      before.description,
      after.description,
      before.description !== undefined,
      after.description !== undefined,
    ));
  }
  if (before.position.x !== after.position.x) {
    changes.push(fieldChange('position.x', 'layout', before.position.x, after.position.x));
  }
  if (before.position.y !== after.position.y) {
    changes.push(fieldChange('position.y', 'layout', before.position.y, after.position.y));
  }
  collectValueChanges(before.config, after.config, 'config', 'runtime', changes);
  return changes;
}

/** Edge identity deliberately excludes display IDs and labels. */
export function getWorkflowEdgeSemanticKey(edge: WorkflowEdge): string {
  return JSON.stringify([
    edge.source,
    edge.target,
    edge.sourceHandle ?? null,
    edge.targetHandle ?? null,
    edge.conditionBranch ?? null,
  ]);
}

function compareEdges(before: WorkflowEdge, after: WorkflowEdge): WorkflowFieldChange[] {
  if (before.label === after.label) return [];
  return [fieldChange(
    'label',
    'presentation',
    before.label,
    after.label,
    before.label !== undefined,
    after.label !== undefined,
  )];
}

function groupEdges(edges: WorkflowEdge[]): Map<string, WorkflowEdge[]> {
  const groups = new Map<string, WorkflowEdge[]>();
  for (const edge of edges) {
    const key = getWorkflowEdgeSemanticKey(edge);
    groups.set(key, [...(groups.get(key) ?? []), edge]);
  }
  for (const group of groups.values()) {
    group.sort((left, right) => {
      const labelOrder = (left.label ?? '').localeCompare(right.label ?? '');
      return labelOrder || left.id.localeCompare(right.id);
    });
  }
  return groups;
}

export function serializeComparisonRevision(
  revision: IWorkflowRevisionDocument,
): WorkflowComparisonRevision {
  return {
    id: revision._id.toString(),
    revision: revision.revision,
    source: revision.source,
    definitionHash: revision.definitionHash,
    createdAt: revision.createdAt,
  };
}

/** Pure, directional comparison of two immutable revision definitions. */
export function compareWorkflowRevisionDefinitions(
  workflowId: string,
  fromRevision: IWorkflowRevisionDocument,
  toRevision: IWorkflowRevisionDocument,
): WorkflowRevisionComparison {
  const fromNodes = new Map(fromRevision.nodes.map((node) => [node.id, node]));
  const toNodes = new Map(toRevision.nodes.map((node) => [node.id, node]));
  const nodeIds = [...new Set([...fromNodes.keys(), ...toNodes.keys()])]
    .sort((left, right) => left.localeCompare(right));

  const addedNodes: WorkflowRevisionComparison['nodes']['added'] = [];
  const removedNodes: WorkflowRevisionComparison['nodes']['removed'] = [];
  const modifiedNodes: WorkflowRevisionComparison['nodes']['modified'] = [];
  for (const nodeId of nodeIds) {
    const before = fromNodes.get(nodeId);
    const after = toNodes.get(nodeId);
    if (!before && after) {
      addedNodes.push({ nodeId, node: redact(after) });
      continue;
    }
    if (before && !after) {
      removedNodes.push({ nodeId, node: redact(before) });
      continue;
    }
    if (!before || !after) continue;
    const allChanges = compareNodes(before, after);
    if (allChanges.length > 0) {
      modifiedNodes.push({
        nodeId,
        before: redact(before),
        after: redact(after),
        changes: allChanges.slice(0, MAX_FIELD_CHANGES_PER_ENTITY),
        changesTruncated: allChanges.length > MAX_FIELD_CHANGES_PER_ENTITY,
      });
    }
  }

  const fromEdges = groupEdges(fromRevision.edges);
  const toEdges = groupEdges(toRevision.edges);
  const semanticKeys = [...new Set([...fromEdges.keys(), ...toEdges.keys()])]
    .sort((left, right) => left.localeCompare(right));
  const addedEdges: WorkflowRevisionComparison['edges']['added'] = [];
  const removedEdges: WorkflowRevisionComparison['edges']['removed'] = [];
  const modifiedEdges: WorkflowRevisionComparison['edges']['modified'] = [];

  for (const semanticKey of semanticKeys) {
    const beforeGroup = fromEdges.get(semanticKey) ?? [];
    const afterGroup = toEdges.get(semanticKey) ?? [];
    const pairCount = Math.min(beforeGroup.length, afterGroup.length);
    for (let index = 0; index < pairCount; index += 1) {
      const before = beforeGroup[index];
      const after = afterGroup[index];
      const changes = compareEdges(before, after);
      if (changes.length > 0) {
        modifiedEdges.push({
          edgeKey: `${semanticKey}#${index + 1}`,
          before: redact(before),
          after: redact(after),
          changes,
          changesTruncated: false,
        });
      }
    }
    for (let index = pairCount; index < beforeGroup.length; index += 1) {
      removedEdges.push({
        edgeKey: `${semanticKey}#${index + 1}`,
        edge: redact(beforeGroup[index]),
      });
    }
    for (let index = pairCount; index < afterGroup.length; index += 1) {
      addedEdges.push({
        edgeKey: `${semanticKey}#${index + 1}`,
        edge: redact(afterGroup[index]),
      });
    }
  }

  const summary = {
    nodes: {
      added: addedNodes.length,
      removed: removedNodes.length,
      modified: modifiedNodes.length,
    },
    edges: {
      added: addedEdges.length,
      removed: removedEdges.length,
      modified: modifiedEdges.length,
    },
  };
  const totalChanges = Object.values(summary.nodes).reduce((total, count) => total + count, 0)
    + Object.values(summary.edges).reduce((total, count) => total + count, 0);

  return {
    workflowId,
    from: serializeComparisonRevision(fromRevision),
    to: serializeComparisonRevision(toRevision),
    hasChanges: totalChanges > 0,
    summary: { totalChanges, ...summary },
    nodes: { added: addedNodes, removed: removedNodes, modified: modifiedNodes },
    edges: { added: addedEdges, removed: removedEdges, modified: modifiedEdges },
    graph: {
      nodes: [...toRevision.nodes]
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((node) => redact(node)),
      edges: [...toRevision.edges]
        .sort((left, right) => {
          const keyOrder = getWorkflowEdgeSemanticKey(left).localeCompare(getWorkflowEdgeSemanticKey(right));
          return keyOrder || left.id.localeCompare(right.id);
        })
        .map((edge) => redact(edge)),
    },
  };
}
