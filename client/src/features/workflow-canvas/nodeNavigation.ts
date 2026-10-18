import type { Edge, Node } from '@xyflow/react';
import type { FlowNodeData } from '@/types';

export const NODE_SEARCH_LIMIT = 30;

/** Finds nodes by visible label and type. Never search configuration or credentials. */
export function findWorkflowNodes(
  nodes: readonly Node<FlowNodeData>[],
  query: string,
  limit = NODE_SEARCH_LIMIT,
): Node<FlowNodeData>[] {
  const needle = query.trim().slice(0, 120).toLocaleLowerCase();
  const max = Math.max(0, Math.min(NODE_SEARCH_LIMIT, Math.floor(limit) || 0));
  if (!needle) return nodes.slice(0, max);
  const found = nodes.filter((node) =>
    node.data.label.toLocaleLowerCase().includes(needle)
    || node.data.nodeType.replaceAll('_', ' ').includes(needle));
  // A label or type prefix ranks ahead of a middle-of-label substring.
  return found.sort((a, b) => {
    const score = (node: Node<FlowNodeData>) => {
      const label = node.data.label.toLocaleLowerCase();
      const type = node.data.nodeType.replaceAll('_', ' ');
      return label === needle || type === needle ? 0
        : label.startsWith(needle) || type.startsWith(needle) ? 1 : 2;
    };
    return score(a) - score(b);
  }).slice(0, max);
}

/**
 * Same connection policy in React Flow and the Zustand mutation boundary.
 * No self-links, missing endpoints, Start targets, End sources, duplicate
 * source-handle/target links or new directed cycles. Existing graph problems
 * may still require preflight review; this only rejects the proposed edge.
 */
export function canConnectWorkflowNodes(
  nodes: readonly Node<FlowNodeData>[],
  edges: readonly Edge[],
  connection: { source: string | null; target: string | null; sourceHandle?: string | null; targetHandle?: string | null },
): boolean {
  const { source, target } = connection;
  if (!source || !target || source === target) return false;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const sourceNode = byId.get(source);
  const targetNode = byId.get(target);
  if (!sourceNode || !targetNode) return false;
  if (sourceNode.data.nodeType === 'end' || targetNode.data.nodeType === 'start') return false;
  if (edges.some((edge) => edge.source === source && edge.target === target
    && (edge.sourceHandle ?? null) === (connection.sourceHandle ?? null))) return false;

  // If target already reaches source, this connection closes a directed loop.
  const next = new Map<string, string[]>();
  for (const edge of edges) {
    if (!byId.has(edge.source) || !byId.has(edge.target)) continue;
    const neighbors = next.get(edge.source) ?? [];
    neighbors.push(edge.target);
    next.set(edge.source, neighbors);
  }
  const visited = new Set<string>();
  const pending = [target];
  while (pending.length) {
    const nodeId = pending.pop()!;
    if (nodeId === source) return false;
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);
    for (const neighbor of next.get(nodeId) ?? []) if (!visited.has(neighbor)) pending.push(neighbor);
  }
  return true;
}
