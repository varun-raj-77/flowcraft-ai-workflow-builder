import { describe, expect, it } from 'vitest';
import type { Node, Edge } from '@xyflow/react';
import type { FlowNodeData } from '@/types';
import { canConnectWorkflowNodes, findWorkflowNodes, NODE_SEARCH_LIMIT } from './nodeNavigation';

const n = (id: string, label: string, nodeType: FlowNodeData['nodeType'] = 'transform'): Node<FlowNodeData> => ({
  id, type: nodeType, position: { x: 0, y: 0 }, data: { label, nodeType, config: {} },
});
const nodes = [n('start', 'Start', 'start'), n('fetch', 'Fetch Orders', 'api_call'), n('filter', 'Filter Orders', 'condition'), n('end', 'End', 'end')];
const edge = (source: string, target: string, sourceHandle: string | null = null): Edge => ({
  id: source + target, source, target, sourceHandle,
});
const connect = (source: string, target: string, sourceHandle: string | null = null) =>
  ({ source, target, sourceHandle, targetHandle: null });

describe('M13 node finder', () => {
  it('matches label/type without looking into sensitive configuration', () => {
    const list = [n('a', 'Fetch Orders', 'api_call'), n('b', 'Second Fetch', 'transform'),
      { ...n('c', 'No match'), data: { ...n('c', 'No match').data, config: { token: 'hiddenSecret' } } }];
    expect(findWorkflowNodes(list, 'FETCH').map((x) => x.id)).toEqual(['a', 'b']);
    expect(findWorkflowNodes(list, 'api call').map((x) => x.id)).toEqual(['a']);
    expect(findWorkflowNodes(list, 'hiddenSecret')).toEqual([]);
  });
  it('prioritizes exact/prefix matches and bounds the number of results', () => {
    const list = [n('1', 'Please fetch data'), n('2', 'Fetch logs'), n('3', 'Fetch')];
    expect(findWorkflowNodes(list, 'fetch').map((x) => x.id)).toEqual(['3', '2', '1']);
    const long = Array.from({ length: 150 }, (_, i) => n(String(i), 'Task'));
    expect(findWorkflowNodes(long, 'task')).toHaveLength(NODE_SEARCH_LIMIT);
    expect(findWorkflowNodes(long, '', 2)).toHaveLength(2);
    expect(findWorkflowNodes(long, '', -2)).toHaveLength(0);
  });
  it('does not mutate the workflow node array while ranking', () => {
    const before = Object.freeze([...nodes]);
    findWorkflowNodes(before, 'ord');
    expect(before.map(x => x.id)).toEqual(['start', 'fetch', 'filter', 'end']);
  });
});

describe('M13 directed connection checks', () => {
  it('allows new valid linear and condition-branch links', () => {
    expect(canConnectWorkflowNodes(nodes, [], connect('start', 'fetch'))).toBe(true);
    expect(canConnectWorkflowNodes(nodes, [edge('start', 'fetch')], connect('filter', 'end', 'condition_false'))).toBe(true);
  });
  it('rejects self, missing node, End source and Start target', () => {
    for (const c of [connect('fetch', 'fetch'), connect('missing', 'fetch'), connect('fetch', 'missing'),
      connect('end', 'fetch'), connect('fetch', 'start')]) expect(canConnectWorkflowNodes(nodes, [], c)).toBe(false);
  });
  it('rejects duplicate links from the same handle but permits distinct condition branches', () => {
    const e = [edge('filter', 'end', 'condition_true')];
    expect(canConnectWorkflowNodes(nodes, e, connect('filter', 'end', 'condition_true'))).toBe(false);
    expect(canConnectWorkflowNodes(nodes, e, connect('filter', 'end', 'condition_false'))).toBe(true);
  });
  it('rejects a long cycle, including through unrelated existing graph components', () => {
    const e = [edge('start', 'fetch'), edge('fetch', 'filter'), edge('filter', 'end')];
    expect(canConnectWorkflowNodes(nodes, e, connect('filter', 'fetch'))).toBe(false);
    expect(canConnectWorkflowNodes(nodes, e, connect('end', 'start'))).toBe(false);
    expect(canConnectWorkflowNodes(nodes, e, connect('start', 'filter'))).toBe(true);
    // Existing unrelated cyclic components cannot hang the reachability traversal.
    const more = [...nodes, n('a', 'A'), n('b', 'B')];
    expect(canConnectWorkflowNodes(more, [edge('a', 'b'), edge('b', 'a')], connect('start', 'fetch'))).toBe(true);
  });
});
