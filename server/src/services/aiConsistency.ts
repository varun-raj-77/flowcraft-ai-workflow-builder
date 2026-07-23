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

const COLLECTION_MEMBERS = new Set([
  'at', 'concat', 'entries', 'every', 'filter', 'find', 'findIndex', 'findLast',
  'findLastIndex', 'flat', 'flatMap', 'forEach', 'includes', 'indexOf', 'join',
  'keys', 'lastIndexOf', 'length', 'map', 'pop', 'push', 'reduce', 'reduceRight',
  'reverse', 'shift', 'slice', 'some', 'sort', 'splice', 'unshift', 'values',
]);

const VALUE_MEMBERS = new Set([
  'charAt', 'endsWith', 'hasOwnProperty', 'includes', 'keys', 'startsWith',
  'toFixed', 'toLowerCase', 'toString', 'toUpperCase', 'trim', 'valueOf',
]);

const API_OUTPUT_MEMBERS = new Set(['headers', 'status']);
const COLLECTION_CALLBACK_METHODS = ['every', 'filter', 'find', 'findIndex', 'flatMap', 'forEach', 'map', 'reduce', 'reduceRight', 'some'];

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

function findClosingParenthesis(code: string, openIndex: number): number {
  let depth = 0;
  let quote: "'" | '"' | '`' | null = null;
  let escaped = false;
  for (let index = openIndex; index < code.length; index += 1) {
    const character = code[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character;
      continue;
    }
    if (character === '(') depth += 1;
    else if (character === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function callbackParameters(argumentsSource: string): string[] {
  const arrowIndex = argumentsSource.indexOf('=>');
  if (arrowIndex < 0) return [];
  const header = argumentsSource.slice(0, arrowIndex).trim().replace(/^async\s+/, '');
  const parameterSource = header.startsWith('(') && header.endsWith(')')
    ? header.slice(1, -1)
    : header;
  return parameterSource
    .split(',')
    .map((parameter) => parameter.trim())
    .filter((parameter) => /^[A-Za-z_$][\w$]*$/.test(parameter));
}

function callbackFieldReferences(code: string): Array<{ nodeId: string; fields: string[] }> {
  const methodPattern = new RegExp(
    `\\binput\\.([A-Za-z_$][\\w$]*)((?:\\.[A-Za-z_$][\\w$]*|\\[\\d+\\])*)\\.(${COLLECTION_CALLBACK_METHODS.join('|')})\\s*\\(`,
    'g',
  );
  const references: Array<{ nodeId: string; fields: string[] }> = [];
  for (const match of code.matchAll(methodPattern)) {
    const openIndex = match.index + match[0].lastIndexOf('(');
    const closeIndex = findClosingParenthesis(code, openIndex);
    if (closeIndex < 0) continue;
    const argumentsSource = code.slice(openIndex + 1, closeIndex);
    const parameters = callbackParameters(argumentsSource);
    const itemParameter = match[3] === 'reduce' || match[3] === 'reduceRight'
      ? parameters[1]
      : parameters[0];
    if (!itemParameter) continue;
    const fieldPattern = new RegExp(`\\b${itemParameter}\\.([A-Za-z_$][\\w$]*)`, 'g');
    for (const fieldMatch of argumentsSource.matchAll(fieldPattern)) {
      if (!VALUE_MEMBERS.has(fieldMatch[1])) {
        references.push({ nodeId: match[1], fields: [fieldMatch[1]] });
      }
    }
  }
  return references;
}

function endpointField(fields: string[]): string | undefined {
  const candidate = fields[0] === 'data' ? fields[1] : fields[0];
  if (!candidate || COLLECTION_MEMBERS.has(candidate) || VALUE_MEMBERS.has(candidate) || API_OUTPUT_MEMBERS.has(candidate)) {
    return undefined;
  }
  return candidate;
}

/** Validates only contradictions proven by generated graph data or known static endpoint hints. */
export function validateGeneratedWorkflowConsistency(workflow: GeneratedWorkflowShape): AIConsistencyIssue[] {
  const nodes = new Map(workflow.nodes.map((node) => [node.id, node]));
  const issues: AIConsistencyIssue[] = [];
  for (const transform of workflow.nodes.filter((node) => node.type === 'transform')) {
    const code = String(transform.config.transformCode ?? '');
    const references = [...inputReferences(code), ...callbackFieldReferences(code)];
    const checkedFields = new Set<string>();
    for (const reference of references) {
      const upstream = nodes.get(reference.nodeId);
      if (!upstream) {
        if (COLLECTION_MEMBERS.has(reference.nodeId) || VALUE_MEMBERS.has(reference.nodeId)) continue;
        issues.push({ code: 'AI_NONEXISTENT_UPSTREAM_NODE', transformNodeId: transform.id, message: `Transform "${transform.label}" references upstream node "${reference.nodeId}", but that node does not exist.` });
        continue;
      }
      if (upstream.type !== 'api_call') continue;
      const fields = knownFields(upstream.config.url);
      if (!fields || reference.fields.length === 0) continue;
      const field = endpointField(reference.fields);
      const fieldKey = `${upstream.id}:${field}`;
      if (field && !checkedFields.has(fieldKey) && !fields.includes(field)) {
        checkedFields.add(fieldKey);
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
