interface GeneratedNode {
  id: string;
  type: string;
  label: string;
  config: Record<string, unknown>;
}

interface GeneratedWorkflowShape {
  nodes: GeneratedNode[];
}

export interface AIConsistencyIssue {
  code: 'AI_NONEXISTENT_UPSTREAM_NODE' | 'AI_KNOWN_ENDPOINT_FIELD_MISMATCH';
  message: string;
  transformNodeId: string;
  apiNodeId?: string;
}

const JSONPLACEHOLDER_FIELDS: Record<string, string[]> = {
  users: ['id', 'name', 'username', 'email', 'address', 'phone', 'website', 'company'],
  posts: ['userId', 'id', 'title', 'body'],
  todos: ['userId', 'id', 'title', 'completed'],
};

function knownFields(url: unknown): string[] | null {
  if (typeof url !== 'string') return null;
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'jsonplaceholder.typicode.com') return null;
    const resource = parsed.pathname.split('/').filter(Boolean)[0];
    return resource ? JSONPLACEHOLDER_FIELDS[resource] ?? null : null;
  } catch {
    return null;
  }
}

function inputReferences(code: string): Array<{ nodeId: string; fields: string[] }> {
  return [...code.matchAll(/\binput\.([A-Za-z_$][\w$]*)((?:\.[A-Za-z_$][\w$]*|\[\d+\])*)/g)].map((match) => ({
    nodeId: match[1],
    fields: (match[2].match(/[A-Za-z_$][\w$]*/g) ?? []),
  }));
}

/** Validates only contradictions proven by generated graph data or known static endpoint hints. */
export function validateGeneratedWorkflowConsistency(workflow: GeneratedWorkflowShape): AIConsistencyIssue[] {
  const nodes = new Map(workflow.nodes.map((node) => [node.id, node]));
  const issues: AIConsistencyIssue[] = [];
  for (const transform of workflow.nodes.filter((node) => node.type === 'transform')) {
    const code = String(transform.config.transformCode ?? '');
    for (const reference of inputReferences(code)) {
      const upstream = nodes.get(reference.nodeId);
      if (!upstream) {
        issues.push({ code: 'AI_NONEXISTENT_UPSTREAM_NODE', transformNodeId: transform.id, message: `Transform "${transform.label}" references upstream node "${reference.nodeId}", but that node does not exist.` });
        continue;
      }
      if (upstream.type !== 'api_call') continue;
      const fields = knownFields(upstream.config.url);
      if (!fields || reference.fields.length === 0) continue;
      const field = reference.fields[0] === 'data' ? reference.fields[1] : reference.fields[0];
      if (field && !fields.includes(field)) {
        issues.push({
          code: 'AI_KNOWN_ENDPOINT_FIELD_MISMATCH',
          transformNodeId: transform.id,
          apiNodeId: upstream.id,
          message: `Transform "${transform.label}" expects "${field}", but API Call "${upstream.label}" uses a JSONPlaceholder endpoint that does not provide that field. Change the endpoint or Transform field reference.`,
        });
      }
    }
  }
  return issues;
}
