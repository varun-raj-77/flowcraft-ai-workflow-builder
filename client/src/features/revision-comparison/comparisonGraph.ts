import type { Edge, Node } from '@xyflow/react';
import { toFlowEdge, toFlowNode } from '@/stores/workflowStore';
import type {
  FlowNodeData,
  WorkflowEdge,
  WorkflowRevisionComparison,
} from '@/types';

function semanticEdgeKey(edge: WorkflowEdge): string {
  return JSON.stringify([
    edge.source,
    edge.target,
    edge.sourceHandle ?? null,
    edge.targetHandle ?? null,
    edge.conditionBranch ?? null,
  ]);
}

function targetEdgeKeys(edges: WorkflowEdge[]): Map<string, string> {
  const groups = new Map<string, WorkflowEdge[]>();
  for (const edge of edges) {
    const key = semanticEdgeKey(edge);
    groups.set(key, [...(groups.get(key) ?? []), edge]);
  }
  const result = new Map<string, string>();
  for (const [key, group] of groups) {
    group
      .sort((left, right) => (left.label ?? '').localeCompare(right.label ?? '') || left.id.localeCompare(right.id))
      .forEach((edge, index) => result.set(edge.id, `${key}#${index + 1}`));
  }
  return result;
}

export function buildComparisonGraph(comparison: WorkflowRevisionComparison): {
  nodes: Array<Node<FlowNodeData>>;
  edges: Edge[];
} {
  const addedNodeIds = new Set(comparison.nodes.added.map(({ nodeId }) => nodeId));
  const modifiedNodeKinds = new Map(
    comparison.nodes.modified.map(({ nodeId, changes }) => [
      nodeId,
      changes.every((change) => change.category === 'layout') ? 'layout' as const : 'modified' as const,
    ]),
  );
  const nodes = comparison.graph.nodes.map((node) => {
    const flowNode = toFlowNode(node);
    const comparisonStatus = addedNodeIds.has(node.id)
      ? 'added' as const
      : modifiedNodeKinds.get(node.id);
    return comparisonStatus
      ? { ...flowNode, data: { ...flowNode.data, comparisonStatus }, draggable: false }
      : { ...flowNode, draggable: false };
  });
  for (const { node } of comparison.nodes.removed) {
    const flowNode = toFlowNode(node);
    nodes.push({
      ...flowNode,
      data: { ...flowNode.data, comparisonStatus: 'removed' },
      draggable: false,
    });
  }

  const addedEdgeKeys = new Set(comparison.edges.added.map(({ edgeKey }) => edgeKey));
  const modifiedEdgeKeys = new Set(comparison.edges.modified.map(({ edgeKey }) => edgeKey));
  const edgeKeys = targetEdgeKeys(comparison.graph.edges);
  const edges = comparison.graph.edges.map((edge) => {
    const flowEdge = toFlowEdge(edge);
    const key = edgeKeys.get(edge.id);
    if (key && addedEdgeKeys.has(key)) {
      return {
        ...flowEdge,
        data: { ...flowEdge.data, comparisonStatus: 'added' },
        style: { stroke: '#10b981', strokeWidth: 3 },
      };
    }
    if (key && modifiedEdgeKeys.has(key)) {
      return {
        ...flowEdge,
        data: { ...flowEdge.data, comparisonStatus: 'modified' },
        style: { stroke: '#f59e0b', strokeWidth: 3 },
      };
    }
    return flowEdge;
  });
  comparison.edges.removed.forEach(({ edge }, index) => {
    edges.push({
      ...toFlowEdge(edge),
      id: `comparison-removed-edge-${index + 1}`,
      data: { conditionBranch: edge.conditionBranch, comparisonStatus: 'removed' },
      style: { stroke: '#ef4444', strokeWidth: 2, strokeDasharray: '7 5', opacity: 0.72 },
    });
  });

  return { nodes, edges };
}
