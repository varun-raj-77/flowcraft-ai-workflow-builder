import { env } from '../config/environment';
import { AppError } from '../middleware/errorHandler.middleware';
import { WORKFLOW_GENERATION_SYSTEM_PROMPT } from '../prompts/workflowGeneration';
import {
  createWorkflowSchema,
  validateNodeConfig,
  validateEdgeReferences,
  validateUniqueNodeIds,
  isValidDAG,
} from '../validators/workflow.validator';

// ── Types ───────────────────────────────────────────────────

interface GeneratedWorkflow {
  name: string;
  description?: string;
  nodes: Array<{
    id: string;
    type: string;
    label: string;
    position: { x: number; y: number };
    config: Record<string, unknown>;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    sourceHandle?: string;
    conditionBranch?: string;
    label?: string;
  }>;
}

// ── LLM API call ────────────────────────────────────────────

async function callLLM(userPrompt: string): Promise<string> {
  if (!env.ANTHROPIC_API_KEY) {
    throw new AppError(503, 'AI_NOT_CONFIGURED', 'AI service is not configured. Set ANTHROPIC_API_KEY in environment variables.');
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: WORKFLOW_GENERATION_SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error('[ai] Anthropic API error:', response.status, errorBody);

    if (response.status === 429) {
      throw new AppError(503, 'AI_RATE_LIMITED', 'AI service is rate limited. Please try again in a moment.');
    }
    if (response.status === 401) {
      throw new AppError(503, 'AI_AUTH_FAILED', 'AI service authentication failed. Check API key.');
    }
    throw new AppError(503, 'AI_UNAVAILABLE', 'AI service is temporarily unavailable. Please try again.');
  }

  const data = await response.json();

  // Extract text from the response content blocks
  const textContent = data.content
    ?.filter((block: { type: string }) => block.type === 'text')
    .map((block: { text: string }) => block.text)
    .join('');

  if (!textContent) {
    throw new AppError(502, 'AI_EMPTY_RESPONSE', 'AI returned an empty response. Try rephrasing your prompt.');
  }

  return textContent;
}

// ── JSON extraction ─────────────────────────────────────────

function extractJSON(raw: string): string {
  // Strip markdown fences if present
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');

  // If it starts with { and ends with }, it's probably JSON
  if (cleaned.startsWith('{') && cleaned.endsWith('}')) {
    return cleaned;
  }

  // Try to find a JSON object in the response
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    return match[0];
  }

  throw new AppError(422, 'AI_INVALID_RESPONSE', 'AI response was not valid JSON. Try rephrasing your prompt.');
}

// ── Validation ──────────────────────────────────────────────

function validateGeneratedWorkflow(data: unknown): GeneratedWorkflow {
  // 1. Zod schema validation (same as manual workflow creation)
  const parsed = createWorkflowSchema.safeParse(data);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new AppError(422, 'AI_SCHEMA_INVALID', `AI generated an invalid workflow: ${issues.join(', ')}`);
  }

  const workflow = parsed.data;

  // 2. Unique node IDs
  const uniqueCheck = validateUniqueNodeIds(workflow.nodes);
  if (!uniqueCheck.valid) {
    throw new AppError(422, 'AI_DUPLICATE_IDS', `AI generated duplicate node IDs: ${uniqueCheck.duplicates.join(', ')}`);
  }

  // 3. Edge references
  const refCheck = validateEdgeReferences(workflow.nodes, workflow.edges);
  if (!refCheck.valid) {
    throw new AppError(422, 'AI_INVALID_EDGES', `AI generated invalid edges: ${refCheck.errors.join('; ')}`);
  }

  // 4. DAG check
  if (!isValidDAG(workflow.nodes, workflow.edges)) {
    throw new AppError(422, 'AI_CYCLE_DETECTED', 'AI generated a workflow with circular dependencies. Try simplifying your prompt.');
  }

  // 5. Per-node config validation
  for (const node of workflow.nodes) {
    const configCheck = validateNodeConfig(node.type, node.config as Record<string, unknown>);
    if (!configCheck.valid) {
      throw new AppError(422, 'AI_INVALID_CONFIG', `AI generated invalid config for "${node.label}": ${configCheck.error}`);
    }
  }

  return workflow as GeneratedWorkflow;
}

// ── Fallback generator (when API key is not set or API fails) ──

function generateFallbackWorkflow(prompt: string): GeneratedWorkflow {
  const lower = prompt.toLowerCase();

  // Detect keywords to build a reasonable workflow
  const hasCondition = lower.includes('check') || lower.includes('if') || lower.includes('condition') || lower.includes('validate');
  const hasDelay = lower.includes('wait') || lower.includes('delay') || lower.includes('pause') || lower.includes('second');
  const hasTransform = lower.includes('transform') || lower.includes('filter') || lower.includes('map') || lower.includes('process') || lower.includes('convert');

  const nodes: GeneratedWorkflow['nodes'] = [
    { id: 'node_0', type: 'start', label: 'Start', position: { x: 0, y: 200 }, config: {} },
    {
      id: 'node_1', type: 'api_call', label: 'Fetch Data',
      position: { x: 280, y: 200 },
      config: { url: 'https://jsonplaceholder.typicode.com/users', method: 'GET', headers: {}, timeout: 5000 },
    },
  ];

  const edges: GeneratedWorkflow['edges'] = [
    { id: 'edge_0', source: 'node_0', target: 'node_1' },
  ];

  let lastNodeId = 'node_1';
  let nextIndex = 2;
  let nextX = 560;

  if (hasCondition) {
    const condId = `node_${nextIndex++}`;
    const trueId = `node_${nextIndex++}`;
    const falseId = `node_${nextIndex++}`;

    nodes.push(
      { id: condId, type: 'condition', label: 'Check Status', position: { x: nextX, y: 200 }, config: { expression: '{{node_1.status}} === 200' } },
      { id: trueId, type: 'output', label: 'Log Success', position: { x: nextX + 280, y: 120 }, config: { logLevel: 'info', message: 'Success: {{node_1.data.length}} items received' } },
      { id: falseId, type: 'output', label: 'Log Error', position: { x: nextX + 280, y: 300 }, config: { logLevel: 'error', message: 'Request failed with status {{node_1.status}}' } },
    );
    edges.push(
      { id: `edge_${edges.length}`, source: lastNodeId, target: condId },
      { id: `edge_${edges.length + 1}`, source: condId, target: trueId, sourceHandle: 'condition_true', conditionBranch: 'true', label: 'Yes' },
      { id: `edge_${edges.length + 2}`, source: condId, target: falseId, sourceHandle: 'condition_false', conditionBranch: 'false', label: 'No' },
    );

    // End node connects from both branches
    const endId = `node_${nextIndex++}`;
    nodes.push({ id: endId, type: 'end', label: 'End', position: { x: nextX + 560, y: 200 }, config: {} });
    edges.push(
      { id: `edge_${edges.length + 3}`, source: trueId, target: endId },
      { id: `edge_${edges.length + 4}`, source: falseId, target: endId },
    );

    return { name: 'AI Generated Workflow', description: `Generated from: "${prompt.slice(0, 80)}"`, nodes, edges };
  }

  if (hasTransform) {
    const tId = `node_${nextIndex++}`;
    nodes.push({
      id: tId, type: 'transform', label: 'Process Data',
      position: { x: nextX, y: 200 },
      config: { transformCode: 'return { processed: input.node_1.data.slice(0, 5) }', description: 'Process and filter results' },
    });
    edges.push({ id: `edge_${edges.length}`, source: lastNodeId, target: tId });
    lastNodeId = tId;
    nextX += 280;
  }

  if (hasDelay) {
    const dId = `node_${nextIndex++}`;
    nodes.push({ id: dId, type: 'delay', label: 'Wait', position: { x: nextX, y: 200 }, config: { delayMs: 2000 } });
    edges.push({ id: `edge_${edges.length}`, source: lastNodeId, target: dId });
    lastNodeId = dId;
    nextX += 280;
  }

  // Always add an output before end
  const outId = `node_${nextIndex++}`;
  nodes.push({
    id: outId, type: 'output', label: 'Log Result',
    position: { x: nextX, y: 200 },
    config: { logLevel: 'info', message: 'Workflow completed. Data: {{node_1.data.length}} items' },
  });
  edges.push({ id: `edge_${edges.length}`, source: lastNodeId, target: outId });
  lastNodeId = outId;
  nextX += 280;

  const endId = `node_${nextIndex++}`;
  nodes.push({ id: endId, type: 'end', label: 'End', position: { x: nextX, y: 200 }, config: {} });
  edges.push({ id: `edge_${edges.length}`, source: lastNodeId, target: endId });

  return { name: 'AI Generated Workflow', description: `Generated from: "${prompt.slice(0, 80)}"`, nodes, edges };
}

// ── Public API ──────────────────────────────────────────────

export async function generateWorkflow(prompt: string): Promise<GeneratedWorkflow> {
  if (!prompt.trim()) {
    throw new AppError(400, 'EMPTY_PROMPT', 'Please provide a description of the workflow you want to create.');
  }

  // Try the real AI first
  if (env.ANTHROPIC_API_KEY) {
    try {
      const rawResponse = await callLLM(prompt);
      const jsonString = extractJSON(rawResponse);

      let parsed: unknown;
      try {
        parsed = JSON.parse(jsonString);
      } catch {
        throw new AppError(422, 'AI_PARSE_FAILED', 'AI response could not be parsed as JSON. Try rephrasing your prompt.');
      }

      return validateGeneratedWorkflow(parsed);
    } catch (err) {
      // If it's a validation error from our pipeline, throw it
      if (err instanceof AppError && err.statusCode < 500) throw err;
      // Otherwise fall through to fallback
      console.warn('[ai] LLM call failed, using fallback generator:', err instanceof Error ? err.message : err);
    }
  }

  // Fallback: generate a sensible workflow without calling the API
  console.log('[ai] Using fallback workflow generator');
  const fallback = generateFallbackWorkflow(prompt);
  return validateGeneratedWorkflow(fallback);
}
