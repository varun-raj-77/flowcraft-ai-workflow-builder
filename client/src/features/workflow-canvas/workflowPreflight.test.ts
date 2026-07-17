import { describe, expect, it } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import type { FlowNodeData } from '@/types';
import { validateWorkflowPreflight } from './workflowPreflight';

const node = (id: string, nodeType: FlowNodeData['nodeType'], config: Record<string, unknown> = {}): Node<FlowNodeData> => ({ id, type: nodeType, position: { x: 0, y: 0 }, data: { nodeType, label: id, config } });
const edge = (source: string, target: string): Edge => ({ id: `${source}-${target}`, source, target });

describe('workflow preflight', () => {
  it('reports ready for a valid linear workflow', () => {
    expect(validateWorkflowPreflight([node('start', 'start'), node('api', 'api_call', { url: 'https://example.com', method: 'GET' }), node('end', 'end')], [edge('start', 'api'), edge('api', 'end')])).toEqual([]);
  });

  it('reports missing start, missing configuration, unreachable nodes and dangling edges', () => {
    const findings = validateWorkflowPreflight([node('api', 'api_call'), node('orphan', 'output', { message: 'x', logLevel: 'info' })], [edge('api', 'missing')]);
    expect(findings.map((finding) => finding.id)).toEqual(expect.arrayContaining(['missing-start', 'config-api', 'dangling-api-missing', 'unreachable-api']));
  });

  it('requires both condition branches and detects cycles', () => {
    const findings = validateWorkflowPreflight([node('start', 'start'), node('condition', 'condition', { expression: 'true' }), node('end', 'end')], [edge('start', 'condition'), edge('condition', 'start'), edge('condition', 'end')]);
    expect(findings.some((finding) => finding.id.startsWith('cycle-'))).toBe(true);
    expect(findings.some((finding) => finding.id === 'condition-true-condition')).toBe(true);
    expect(findings.some((finding) => finding.id === 'condition-false-condition')).toBe(true);
  });
});
