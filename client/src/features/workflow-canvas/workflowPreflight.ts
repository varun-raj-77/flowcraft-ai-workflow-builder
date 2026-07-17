import type { Edge, Node } from '@xyflow/react';
import type { FlowNodeData } from '@/types';

export interface PreflightFinding { id: string; severity: 'error' | 'warning'; message: string; nodeId?: string; }

const configError = (node: Node<FlowNodeData>): string | null => {
  const config = node.data.config as Record<string, unknown>;
  if (node.data.nodeType === 'api_call' && (!config.url || !config.method)) return 'API Call is missing a URL or method.';
  if (node.data.nodeType === 'condition' && !config.expression) return 'Condition is missing an expression.';
  if (node.data.nodeType === 'transform' && !config.transformCode) return 'Transform is missing code.';
  if (node.data.nodeType === 'delay' && typeof config.delayMs !== 'number') return 'Delay is missing a duration.';
  if (node.data.nodeType === 'output' && !config.message) return 'Output is missing a message.';
  return null;
};

export function validateWorkflowPreflight(nodes: Node<FlowNodeData>[], edges: Edge[]): PreflightFinding[] {
  const findings: PreflightFinding[] = [];
  if (!nodes.length) return [{ id: 'empty', severity: 'error', message: 'Add a Start node to begin a workflow.' }];
  const ids = new Set<string>();
  nodes.forEach((node) => { if (ids.has(node.id)) findings.push({ id: `duplicate-${node.id}`, severity: 'error', message: `Duplicate node ID: ${node.id}.`, nodeId: node.id }); ids.add(node.id); });
  const starts = nodes.filter((node) => node.data.nodeType === 'start');
  if (!starts.length) findings.push({ id: 'missing-start', severity: 'error', message: 'Workflow has no Start node.' });
  if (starts.length > 1) findings.push({ id: 'multiple-start', severity: 'warning', message: 'Workflow has multiple Start nodes.' });
  const byId = new Map(nodes.map((node) => [node.id, node]));
  edges.forEach((edge) => { if (!byId.has(edge.source) || !byId.has(edge.target)) findings.push({ id: `dangling-${edge.id}`, severity: 'error', message: 'Connection references a node that no longer exists.' }); });
  const outgoing = new Map<string, Edge[]>();
  edges.forEach((edge) => { if (byId.has(edge.source) && byId.has(edge.target)) outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]); });
  const reachable = new Set<string>();
  const visit = (id: string, trail = new Set<string>()) => {
    if (trail.has(id)) { findings.push({ id: `cycle-${id}`, severity: 'error', message: 'Workflow contains a cycle.', nodeId: id }); return; }
    if (reachable.has(id)) return;
    reachable.add(id);
    const nextTrail = new Set(trail); nextTrail.add(id);
    (outgoing.get(id) ?? []).forEach((edge) => visit(edge.target, nextTrail));
  };
  starts.forEach((node) => visit(node.id));
  nodes.forEach((node) => {
    const issue = configError(node); if (issue) findings.push({ id: `config-${node.id}`, severity: 'error', message: issue, nodeId: node.id });
    if (!reachable.has(node.id)) findings.push({ id: `unreachable-${node.id}`, severity: 'warning', message: `${node.data.label} is unreachable from Start.`, nodeId: node.id });
    if (node.data.nodeType === 'condition') {
      const branches = outgoing.get(node.id) ?? [];
      if (!branches.some((edge) => edge.sourceHandle === 'condition_true')) findings.push({ id: `condition-true-${node.id}`, severity: 'error', message: `Condition '${node.data.label}' has no true-path connection.`, nodeId: node.id });
      if (!branches.some((edge) => edge.sourceHandle === 'condition_false')) findings.push({ id: `condition-false-${node.id}`, severity: 'error', message: `Condition '${node.data.label}' has no false-path connection.`, nodeId: node.id });
    }
  });
  if (starts.length && !nodes.some((node) => node.data.nodeType === 'end' && reachable.has(node.id))) findings.push({ id: 'no-end', severity: 'error', message: 'No reachable End node exists.' });
  return [...new Map(findings.map((finding) => [finding.id, finding])).values()];
}
