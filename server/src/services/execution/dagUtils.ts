interface GraphNode {
  id: string;
  type: string;
}

interface GraphEdge {
  source: string;
  target: string;
  conditionBranch?: string;
}

/**
 * Topological sort using Kahn's algorithm.
 * Returns node IDs in a valid execution order.
 * Throws if the graph contains a cycle (should never happen — validated on save).
 */
export function topologicalSort(nodes: GraphNode[], edges: GraphEdge[]): string[] {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const node of nodes) {
    inDegree.set(node.id, 0);
    adjacency.set(node.id, []);
  }

  for (const edge of edges) {
    adjacency.get(edge.source)?.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
  }

  // Start with all nodes that have no incoming edges
  const queue: string[] = [];
  for (const [nodeId, degree] of inDegree) {
    if (degree === 0) queue.push(nodeId);
  }

  const sorted: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);

    for (const neighbor of adjacency.get(current) || []) {
      const newDegree = (inDegree.get(neighbor) || 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) {
        queue.push(neighbor);
      }
    }
  }

  if (sorted.length !== nodes.length) {
    throw new Error('Cycle detected in workflow graph');
  }

  return sorted;
}

/**
 * Given a condition node that evaluated to a result, determines which
 * downstream nodes should be skipped (the not-taken branch).
 *
 * Strategy: find edges from the condition where conditionBranch matches
 * the NOT-taken side. Walk forward from those targets, marking nodes
 * as skipped — unless a node has an incoming edge from a non-skipped node
 * (meaning it's a merge point reachable from the taken branch).
 */
export function findSkippedNodes(
  conditionNodeId: string,
  branchTaken: 'true' | 'false',
  edges: GraphEdge[],
  alreadySkipped: Set<string>,
): Set<string> {
  const notTakenBranch = branchTaken === 'true' ? 'false' : 'true';
  const toSkip = new Set<string>();

  // Find the direct target of the not-taken branch
  const notTakenEdges = edges.filter(
    (e) => e.source === conditionNodeId && e.conditionBranch === notTakenBranch,
  );

  // Build adjacency for forward traversal
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, []);
    adjacency.get(edge.source)!.push(edge.target);
  }

  // Build reverse adjacency to check merge points
  const incomingEdges = new Map<string, Array<{ source: string; conditionBranch?: string }>>();
  for (const edge of edges) {
    if (!incomingEdges.has(edge.target)) incomingEdges.set(edge.target, []);
    incomingEdges.get(edge.target)!.push({ source: edge.source, conditionBranch: edge.conditionBranch });
  }

  // BFS from not-taken targets
  const queue = notTakenEdges.map((e) => e.target);

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (toSkip.has(nodeId)) continue;

    // Check if this node is a merge point: does it have ANY incoming edge
    // from a node that is NOT skipped and NOT on the not-taken path?
    const incoming = incomingEdges.get(nodeId) || [];
    const hasLiveIncoming = incoming.some((inc) => {
      // The condition node itself is live (it executed)
      if (inc.source === conditionNodeId && inc.conditionBranch !== notTakenBranch) return true;
      // Any other non-skipped source
      if (inc.source !== conditionNodeId && !toSkip.has(inc.source) && !alreadySkipped.has(inc.source)) return true;
      return false;
    });

    if (hasLiveIncoming) continue; // Merge point — don't skip

    toSkip.add(nodeId);

    // Continue forward
    for (const next of adjacency.get(nodeId) || []) {
      if (!toSkip.has(next)) queue.push(next);
    }
  }

  return toSkip;
}
