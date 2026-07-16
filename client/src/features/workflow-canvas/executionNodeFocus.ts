export interface FocusableExecutionNode {
  id: string;
  position: { x: number; y: number };
}

interface FocusExecutionNodeOptions {
  selectedNodeId: string | null;
  lastFocusedNodeId: string | null;
  nodes: readonly FocusableExecutionNode[];
  getViewport: () => { zoom: number };
  setCenter: (x: number, y: number, options: { zoom: number; duration: number }) => void;
}

/**
 * Centers a newly selected execution node exactly once. Returning the last
 * focused id lets the canvas safely react to controlled graph updates without
 * fighting a user's subsequent pan, zoom, or drag operation.
 */
export function focusExecutionNode({
  selectedNodeId,
  lastFocusedNodeId,
  nodes,
  getViewport,
  setCenter,
}: FocusExecutionNodeOptions): string | null {
  if (!selectedNodeId) return null;
  if (selectedNodeId === lastFocusedNodeId) return lastFocusedNodeId;

  const node = nodes.find((item) => item.id === selectedNodeId);
  if (!node) return lastFocusedNodeId;

  setCenter(node.position.x + 100, node.position.y + 30, {
    zoom: getViewport().zoom,
    duration: 250,
  });
  return selectedNodeId;
}
