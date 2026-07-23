import { env } from '../config/environment';
import { AppError } from '../middleware/errorHandler.middleware';
import { WORKFLOW_GENERATION_SYSTEM_PROMPT } from '../prompts/workflowGeneration';
import { createWorkflowSchema, validateNodeConfig, validateEdgeReferences, validateUniqueNodeIds, isValidDAG } from '../validators/workflow.validator';
import { redactText } from '../utils/redact';
import { assessCapabilityCoverage, type CapabilityCoverage } from './aiCapabilities';
import { validateGeneratedApiAuthentication, validatePromptAuthenticationIntent } from './aiAuthentication';
import { validateGeneratedWorkflowConsistency } from './aiConsistency';

export interface GeneratedWorkflow {
  name: string;
  description?: string;
  nodes: Array<{ id: string; type: string; label: string; position: { x: number; y: number }; config: Record<string, unknown> }>;
  edges: Array<{ id: string; source: string; target: string; sourceHandle?: string; conditionBranch?: string; label?: string }>;
  generationMetadata: {
    originalPrompt: string;
    generatedAt: string;
    provider: string;
    model: string;
    capabilityCoverage: CapabilityCoverage;
  };
}

async function callLLM(userPrompt: string): Promise<string> {
  if (!env.ANTHROPIC_API_KEY) {
    throw new AppError(503, 'AI_NOT_CONFIGURED', 'AI service is not configured. Set ANTHROPIC_API_KEY in environment variables.');
  }
  let response: Response;
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: env.ANTHROPIC_MODEL, max_tokens: 4096, system: WORKFLOW_GENERATION_SYSTEM_PROMPT, messages: [{ role: 'user', content: userPrompt }] }),
    });
  } catch (error) {
    console.warn('[ai] Provider request failed:', redactText(error instanceof Error ? error.message : String(error)));
    throw new AppError(503, 'AI_UNAVAILABLE', 'AI service is temporarily unavailable. Please try again.');
  }
  if (!response.ok) {
    const errorBody = await response.text();
    console.error('[ai] Anthropic API error:', response.status, redactText(errorBody));
    if (response.status === 429) throw new AppError(503, 'AI_RATE_LIMITED', 'AI service is rate limited. Please try again in a moment.');
    if (response.status === 401) throw new AppError(503, 'AI_AUTH_FAILED', 'AI service authentication failed. Check API key.');
    throw new AppError(503, 'AI_UNAVAILABLE', 'AI service is temporarily unavailable. Please try again.');
  }
  const data = await response.json() as { content?: Array<{ type: string; text?: string }> };
  const text = data.content?.filter((block) => block.type === 'text').map((block) => block.text ?? '').join('');
  if (!text) throw new AppError(502, 'AI_EMPTY_RESPONSE', 'AI returned an empty response. Try rephrasing your prompt.');
  return text;
}

function extractJSON(raw: string): string {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  if (cleaned.startsWith('{') && cleaned.endsWith('}')) return cleaned;
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) return match[0];
  throw new AppError(422, 'AI_INVALID_RESPONSE', 'AI response was not valid JSON. Try rephrasing your prompt.');
}

function validateGeneratedWorkflow(data: unknown): Omit<GeneratedWorkflow, 'generationMetadata'> {
  const parsed = createWorkflowSchema.safeParse(data);
  if (!parsed.success) throw new AppError(422, 'AI_SCHEMA_INVALID', `AI generated an invalid workflow: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')}`);
  const workflow = parsed.data;
  const uniqueCheck = validateUniqueNodeIds(workflow.nodes);
  if (!uniqueCheck.valid) throw new AppError(422, 'AI_DUPLICATE_IDS', `AI generated duplicate node IDs: ${uniqueCheck.duplicates.join(', ')}`);
  const referenceCheck = validateEdgeReferences(workflow.nodes, workflow.edges);
  if (!referenceCheck.valid) throw new AppError(422, 'AI_INVALID_EDGES', `AI generated invalid edges: ${referenceCheck.errors.join('; ')}`);
  if (!isValidDAG(workflow.nodes, workflow.edges)) throw new AppError(422, 'AI_CYCLE_DETECTED', 'AI generated a workflow with circular dependencies. Try simplifying your prompt.');
  for (const node of workflow.nodes) {
    const configCheck = validateNodeConfig(node.type, node.config as Record<string, unknown>);
    if (!configCheck.valid) throw new AppError(422, 'AI_INVALID_CONFIG', `AI generated invalid config for "${node.label}": ${configCheck.error}`);
  }
  return workflow as Omit<GeneratedWorkflow, 'generationMetadata'>;
}

/** Calls the configured provider. There is intentionally no generic production fallback. */
export async function generateWorkflow(prompt: string): Promise<GeneratedWorkflow> {
  if (!prompt.trim()) throw new AppError(400, 'EMPTY_PROMPT', 'Please provide a description of the workflow you want to create.');
  const authenticationIntentIssue = validatePromptAuthenticationIntent(prompt);
  if (authenticationIntentIssue) {
    throw new AppError(422, authenticationIntentIssue.code, authenticationIntentIssue.message);
  }
  const rawResponse = await callLLM(prompt);
  let parsed: unknown;
  try { parsed = JSON.parse(extractJSON(rawResponse)); } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(422, 'AI_PARSE_FAILED', 'AI response could not be parsed as JSON. Try rephrasing your prompt.');
  }
  const workflow = validateGeneratedWorkflow(parsed);
  const authenticationIssues = validateGeneratedApiAuthentication(workflow);
  if (authenticationIssues.length > 0) {
    throw new AppError(422, authenticationIssues[0].code, authenticationIssues[0].message);
  }
  const consistencyIssues = validateGeneratedWorkflowConsistency(workflow);
  if (consistencyIssues.length > 0) {
    throw new AppError(422, consistencyIssues[0].code, consistencyIssues[0].message);
  }
  return {
    ...workflow,
    generationMetadata: {
      originalPrompt: prompt.trim(),
      generatedAt: new Date().toISOString(),
      provider: 'anthropic',
      model: env.ANTHROPIC_MODEL,
      capabilityCoverage: assessCapabilityCoverage(prompt, workflow),
    },
  };
}
