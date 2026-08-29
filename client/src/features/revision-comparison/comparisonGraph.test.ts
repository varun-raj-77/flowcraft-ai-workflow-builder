import { describe, expect, it } from 'vitest';
import type { WorkflowRevisionComparison } from '@/types';
import { buildComparisonGraph } from './comparisonGraph';

const start = { id: 'start', type: 'start' as const, label: 'Start', position: { x: 0, y: 0 }, config: {} };
const end = { id: 'end', type: 'end' as const, label: 'End', position: { x: 400, y: 0 }, config: {} };
const added = { id: 'delay', type: 'delay' as const, label: 'Wait', position: { x: 200, y: 0 }, config: { delayMs: 500 } };
const removed = { id: 'api', type: 'api_call' as const, label: 'Old API', position: { x: 180, y: 120 }, config: { url: 'https://old.test', method: 'GET' as const, headers: {} } };

const comparison: WorkflowRevisionComparison = {
  workflowId: 'workflow-1',
  from: { id: 'r1', revision: 1, source: 'manual', definitionHash: '1'.repeat(64), createdAt: '2026-08-01T00:00:00.000Z' },
  to: { id: 'r2', revision: 2, source: 'manual', definitionHash: '2'.repeat(64), createdAt: '2026-08-02T00:00:00.000Z' },
  hasChanges: true,
  summary: { totalChanges: 4, nodes: { added: 1, removed: 1, modified: 1 }, edges: { added: 1, removed: 1, modified: 0 } },
  nodes: {
    added: [{ nodeId: 'delay', node: added }],
    removed: [{ nodeId: 'api', node: removed }],
    modified: [{
      nodeId: 'end',
      before: { ...end, position: { x: 350, y: 0 } },
      after: end,
      changes: [{ path: 'position.x', category: 'layout', beforePresent: true, afterPresent: true, before: 350, after: 400 }],
      changesTruncated: false,
    }],
  },
  edges: {
    added: [{ edgeKey: '["start","delay",null,null,null]#1', edge: { id: 'new-edge', source: 'start', target: 'delay' } }],
    removed: [{ edgeKey: '["start","api",null,null,null]#1', edge: { id: 'old-edge', source: 'start', target: 'api' } }],
    modified: [],
  },
  graph: {
    nodes: [start, added, end],
    edges: [{ id: 'new-edge', source: 'start', target: 'delay' }],
  },
};

describe('comparison graph projection', () => {
  it('renders the target graph plus removed ghosts with distinct change styling', () => {
    const graph = buildComparisonGraph(comparison);

    expect(graph.nodes.map((node) => node.id)).toEqual(['start', 'delay', 'end', 'api']);
    expect(graph.nodes.find((node) => node.id === 'delay')?.data.comparisonStatus).toBe('added');
    expect(graph.nodes.find((node) => node.id === 'end')?.data.comparisonStatus).toBe('layout');
    expect(graph.nodes.find((node) => node.id === 'api')).toMatchObject({
      position: { x: 180, y: 120 },
      data: { comparisonStatus: 'removed' },
      draggable: false,
    });
    expect(graph.edges[0].style).toMatchObject({ stroke: '#10b981', strokeWidth: 3 });
    expect(graph.edges[1]).toMatchObject({
      id: 'comparison-removed-edge-1',
      data: { comparisonStatus: 'removed' },
    });
  });
});
