import { describe, expect, it } from 'vitest';
import { compareWorkflowRevisionDefinitions } from './workflowComparison';
import { calculateDefinitionHash, type WorkflowDefinition } from './workflowDefinition';

type TestNode = WorkflowDefinition['nodes'][number];
type TestEdge = WorkflowDefinition['edges'][number];

function objectId(value: string) {
  return { toString: () => value };
}

const startNode: TestNode = {
  id: 'start', type: 'start' as const, label: 'Start', position: { x: 0, y: 0 }, config: {},
};
const apiNode: TestNode = {
  id: 'api', type: 'api_call' as const, label: 'Fetch', position: { x: 200, y: 0 },
  config: { url: 'https://example.test', method: 'GET' as const, headers: {} },
};
const endNode: TestNode = {
  id: 'end', type: 'end' as const, label: 'End', position: { x: 400, y: 0 }, config: {},
};
const baseEdges: TestEdge[] = [
  { id: 'visual-a', source: 'start', target: 'api', label: 'first' },
  { id: 'visual-b', source: 'api', target: 'end' },
];

function revision(
  number: number,
  nodes: TestNode[] = [startNode, apiNode, endNode],
  edges: TestEdge[] = baseEdges,
) {
  return {
    _id: objectId(`revision-${number}`),
    workflowId: objectId('workflow-1'),
    userId: 'user-1',
    revision: number,
    parentRevisionId: number === 1 ? null : objectId(`revision-${number - 1}`),
    source: 'manual' as const,
    nodes,
    edges,
    definitionHash: calculateDefinitionHash({ nodes, edges }),
    createdAt: new Date(`2026-01-0${number}T00:00:00.000Z`),
  } as never;
}

describe('deterministic workflow revision comparison', () => {
  it('A: returns an explicit empty diff for the same revision', () => {
    const v1 = revision(1);
    const result = compareWorkflowRevisionDefinitions('workflow-1', v1, v1);

    expect(result.hasChanges).toBe(false);
    expect(result.summary.totalChanges).toBe(0);
    expect(result.nodes).toEqual({ added: [], removed: [], modified: [] });
    expect(result.edges).toEqual({ added: [], removed: [], modified: [] });
  });

  it('B: reports stable-ID node additions and removals', () => {
    const delay = { id: 'delay', type: 'delay' as const, label: 'Wait', position: { x: 300, y: 80 }, config: { delayMs: 500 } };
    const result = compareWorkflowRevisionDefinitions(
      'workflow-1',
      revision(1),
      revision(2, [startNode, apiNode, delay]),
    );

    expect(result.nodes.added.map((item) => item.nodeId)).toEqual(['delay']);
    expect(result.nodes.removed.map((item) => item.nodeId)).toEqual(['end']);
  });

  it('C: categorizes nested config changes as runtime definition changes', () => {
    const changed = { ...apiNode, config: { ...apiNode.config, method: 'POST' as const, headers: { 'x-mode': 'new' } } };
    const result = compareWorkflowRevisionDefinitions('workflow-1', revision(1), revision(2, [startNode, changed, endNode]));

    expect(result.nodes.modified[0].changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'config.method', category: 'runtime', before: 'GET', after: 'POST' }),
      expect.objectContaining({ path: 'config.headers.x-mode', category: 'runtime', beforePresent: false, after: 'new' }),
    ]));
  });

  it('D: categorizes label and description as presentation changes', () => {
    const changed = { ...apiNode, label: 'Fetch users', description: 'Displayed help' };
    const result = compareWorkflowRevisionDefinitions('workflow-1', revision(1), revision(2, [startNode, changed, endNode]));

    expect(result.nodes.modified[0].changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'label', category: 'presentation' }),
      expect.objectContaining({ path: 'description', category: 'presentation' }),
    ]));
  });

  it('E: categorizes position changes as layout-only changes', () => {
    const moved = { ...apiNode, position: { x: 250, y: 90 } };
    const result = compareWorkflowRevisionDefinitions('workflow-1', revision(1), revision(2, [startNode, moved, endNode]));

    expect(result.nodes.modified[0].changes).toEqual([
      expect.objectContaining({ path: 'position.x', category: 'layout' }),
      expect.objectContaining({ path: 'position.y', category: 'layout' }),
    ]);
  });

  it('F: compares executable edge identity semantically and display labels as modifications', () => {
    const changedEdges = [
      { id: 'entirely-new-display-id', source: 'start', target: 'api', label: 'renamed' },
      { id: 'new-branch', source: 'start', target: 'end' },
    ];
    const result = compareWorkflowRevisionDefinitions('workflow-1', revision(1), revision(2, undefined, changedEdges));

    expect(result.edges.modified).toHaveLength(1);
    expect(result.edges.modified[0].changes[0]).toMatchObject({ path: 'label', category: 'presentation' });
    expect(result.edges.added).toHaveLength(1);
    expect(result.edges.removed).toHaveLength(1);
  });

  it('G: is directional, so reversing revisions swaps additions and removals', () => {
    const delay = { id: 'delay', type: 'delay' as const, label: 'Wait', position: { x: 300, y: 80 }, config: { delayMs: 500 } };
    const v1 = revision(1);
    const v2 = revision(2, [startNode, apiNode, endNode, delay]);
    const forward = compareWorkflowRevisionDefinitions('workflow-1', v1, v2);
    const reverse = compareWorkflowRevisionDefinitions('workflow-1', v2, v1);

    expect(forward.nodes.added[0].nodeId).toBe('delay');
    expect(reverse.nodes.removed[0].nodeId).toBe('delay');
  });

  it('H: redacts secrets in field values and graph snapshots while remaining deterministic', () => {
    const before = { ...apiNode, config: { ...apiNode.config, headers: { Authorization: 'Bearer old-secret' }, body: 'token=old-secret' } };
    const after = { ...apiNode, config: { ...apiNode.config, headers: { Authorization: 'Bearer new-secret' }, body: 'token=new-secret' } };
    const first = compareWorkflowRevisionDefinitions('workflow-1', revision(1, [startNode, before, endNode]), revision(2, [startNode, after, endNode]));
    const second = compareWorkflowRevisionDefinitions('workflow-1', revision(1, [startNode, before, endNode]), revision(2, [startNode, after, endNode]));
    const serialized = JSON.stringify(first);

    expect(first).toEqual(second);
    expect(serialized).not.toContain('old-secret');
    expect(serialized).not.toContain('new-secret');
    expect(serialized).toContain('[REDACTED]');
  });
});
