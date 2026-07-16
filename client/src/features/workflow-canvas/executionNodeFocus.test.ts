import { describe, expect, it, vi } from 'vitest';
import { focusExecutionNode } from './executionNodeFocus';

const nodes = [
  { id: 'first', position: { x: 10, y: 20 } },
  { id: 'second', position: { x: 40, y: 50 } },
];

function focus(selectedNodeId: string | null, lastFocusedNodeId: string | null, currentNodes = nodes) {
  const setCenter = vi.fn();
  const nextFocusedNodeId = focusExecutionNode({
    selectedNodeId,
    lastFocusedNodeId,
    nodes: currentNodes,
    getViewport: () => ({ zoom: 0.6 }),
    setCenter,
  });
  return { setCenter, nextFocusedNodeId };
}

describe('focusExecutionNode', () => {
  it('centers a newly selected execution step once without changing zoom', () => {
    const result = focus('first', null);
    expect(result.setCenter).toHaveBeenCalledOnce();
    expect(result.setCenter).toHaveBeenCalledWith(110, 50, { zoom: 0.6, duration: 250 });
    expect(result.nextFocusedNodeId).toBe('first');
  });

  it('does not recenter after unrelated node updates or dragging the selected node', () => {
    const movedNodes = nodes.map((node) => node.id === 'first' ? { ...node, position: { x: 400, y: 500 } } : node);
    const result = focus('first', 'first', movedNodes);
    expect(result.setCenter).not.toHaveBeenCalled();
    expect(result.nextFocusedNodeId).toBe('first');
  });

  it('centers a different selected step and focuses the retained selection after canvas restoration', () => {
    const changedSelection = focus('second', 'first');
    expect(changedSelection.setCenter).toHaveBeenCalledWith(140, 80, { zoom: 0.6, duration: 250 });

    const restoredCanvas = focus('second', null);
    expect(restoredCanvas.setCenter).toHaveBeenCalledOnce();
    expect(restoredCanvas.nextFocusedNodeId).toBe('second');
  });
});
