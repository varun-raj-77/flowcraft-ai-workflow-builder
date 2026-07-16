export type AICapability =
  | 'api_call'
  | 'transform'
  | 'qualification_condition'
  | 'delay'
  | 'output'
  | 'ai_summary';

export interface CapabilityCoverage {
  requestedCapabilities: AICapability[];
  implementedCapabilities: AICapability[];
  missingCapabilities: AICapability[];
  unsupportedCapabilities: AICapability[];
  coverage: number;
  isComplete: boolean;
}

interface GeneratedNode {
  id: string;
  type: string;
  label: string;
  config: Record<string, unknown>;
}

interface GeneratedWorkflowShape {
  nodes: GeneratedNode[];
  edges: Array<{ source: string; target: string }>;
}

/** The single source of truth for operations the AI generator may promise. */
export const AI_CAPABILITIES: Record<AICapability, { supported: boolean; nodeType?: string; description: string }> = {
  api_call: { supported: true, nodeType: 'api_call', description: 'Call an HTTP API' },
  transform: { supported: true, nodeType: 'transform', description: 'Transform data with JavaScript' },
  qualification_condition: { supported: true, nodeType: 'condition', description: 'Branch on a condition or qualification rule' },
  delay: { supported: true, nodeType: 'delay', description: 'Wait before continuing' },
  output: { supported: true, nodeType: 'output', description: 'Log or return a workflow result' },
  ai_summary: { supported: false, description: 'Generate an executable AI/LLM summary' },
};

export const AI_CAPABILITY_PROMPT = `
## Capability contract

FlowCraft can execute only HTTP API calls, JavaScript transforms, conditions, delays, outputs, and start/end nodes. There is no executable AI/LLM node. Never represent an AI summary as an Output node. Preserve the user's requested purpose in labels and configuration: an enrichment API must be labelled/configured for enrichment, and a company qualification condition must reference the requested company fields rather than HTTP status. When a prompt asks for an executable AI summary, return the supported subset only; it will be marked incomplete by the server.`;

function addIf(matches: Set<AICapability>, condition: boolean, capability: AICapability) {
  if (condition) matches.add(capability);
}

export function identifyRequestedCapabilities(prompt: string): AICapability[] {
  const text = prompt.toLowerCase();
  const requested = new Set<AICapability>();

  addIf(requested, /\b(fetch|call|request|api|enrich|enrichment)\b/.test(text), 'api_call');
  addIf(requested, /\b(transform|filter|map|normalize|process|merge|convert)\b/.test(text), 'transform');
  addIf(requested, /\b(qualif|condition|check|validate|rule|company size|industry)\b/.test(text), 'qualification_condition');
  addIf(requested, /\b(wait|delay|pause)\b/.test(text), 'delay');
  addIf(requested, /\b(return|output|log|result|alert)\b/.test(text), 'output');
  addIf(requested, /\b(ai|llm|artificial intelligence)\b[\s\S]{0,40}\b(summary|summarize|summarise)\b|\b(generate|create)\s+(an\s+)?ai\s+summary\b/.test(text), 'ai_summary');

  return [...requested];
}

function containsPurpose(node: GeneratedNode, keywords: RegExp): boolean {
  return keywords.test(`${node.label} ${JSON.stringify(node.config)}`.toLowerCase());
}

function hasRequestedOrder(workflow: GeneratedWorkflowShape, requested: AICapability[]): boolean {
  const typesById = new Map(workflow.nodes.map((node) => [node.id, node.type]));
  const successors = new Map<string, string[]>();
  for (const edge of workflow.edges) {
    successors.set(edge.source, [...(successors.get(edge.source) ?? []), edge.target]);
  }
  const capabilityForType: Record<string, AICapability | undefined> = {
    api_call: 'api_call', transform: 'transform', condition: 'qualification_condition', delay: 'delay', output: 'output',
  };
  const seen = new Set<AICapability>();
  const visit = (id: string) => {
    const capability = capabilityForType[typesById.get(id) ?? ''];
    if (capability) seen.add(capability);
    for (const next of successors.get(id) ?? []) visit(next);
  };
  const start = workflow.nodes.find((node) => node.type === 'start');
  if (start) visit(start.id);
  const ordered = [...seen];
  let index = 0;
  for (const capability of requested.filter((item) => item !== 'ai_summary')) {
    const found = ordered.indexOf(capability, index);
    if (found === -1) return false;
    index = found + 1;
  }
  return true;
}

export function assessCapabilityCoverage(prompt: string, workflow: GeneratedWorkflowShape): CapabilityCoverage {
  const requestedCapabilities = identifyRequestedCapabilities(prompt);
  const implemented = new Set<AICapability>();
  const text = prompt.toLowerCase();
  const nodes = workflow.nodes;

  if (nodes.some((node) => node.type === 'api_call') && (!/enrich|customer/.test(text) || nodes.some((node) => node.type === 'api_call' && containsPurpose(node, /enrich|customer/)))) implemented.add('api_call');
  if (nodes.some((node) => node.type === 'transform')) implemented.add('transform');
  if (nodes.some((node) => node.type === 'condition') && (!/company size|industry|qualif/.test(text) || nodes.some((node) => node.type === 'condition' && containsPurpose(node, /company|size|industry|qualif/)))) implemented.add('qualification_condition');
  if (nodes.some((node) => node.type === 'delay')) implemented.add('delay');
  if (nodes.some((node) => node.type === 'output')) implemented.add('output');

  const unsupportedCapabilities = requestedCapabilities.filter((capability) => !AI_CAPABILITIES[capability].supported);
  const missingCapabilities = requestedCapabilities.filter((capability) => !implemented.has(capability));
  const orderingMatches = hasRequestedOrder(workflow, requestedCapabilities);
  if (!orderingMatches) {
    for (const capability of requestedCapabilities) {
      if (capability !== 'ai_summary' && implemented.has(capability) && !missingCapabilities.includes(capability)) missingCapabilities.push(capability);
    }
  }
  const implementedCapabilities = requestedCapabilities.filter((capability) => implemented.has(capability));
  const coverage = requestedCapabilities.length === 0 ? 1 : implementedCapabilities.length / requestedCapabilities.length;

  return { requestedCapabilities, implementedCapabilities, missingCapabilities, unsupportedCapabilities, coverage, isComplete: missingCapabilities.length === 0 && unsupportedCapabilities.length === 0 && orderingMatches };
}
