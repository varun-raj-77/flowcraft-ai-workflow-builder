interface GeneratedNode {
  id: string;
  type: string;
  label: string;
  config: Record<string, unknown>;
}

interface GeneratedWorkflowShape {
  nodes: GeneratedNode[];
}

export interface AIAuthenticationIssue {
  code: 'AI_AUTHENTICATION_REQUIRED' | 'AI_UNSUPPORTED_SECRET_REFERENCE' | 'AI_UNSAFE_EMBEDDED_CREDENTIAL';
  message: string;
  apiNodeId?: string;
}

const GITHUB_ACCOUNT_INTENT = [
  /\b(?:issues?\s+)?assigned\s+to\s+(?:me|myself|the\s+(?:current|authenticated)\s+user)\b/i,
  /\bmy\s+(?:assigned\s+)?(?:github\s+)?issues?\b/i,
  /\bmy\s+github\s+(?:account|repositories?|repos?)\b/i,
  /\bprivate\s+(?:github\s+)?(?:repositories?|repos?)\b/i,
  /\b(?:github\s+)?(?:repositories?|repos?)\s+I\s+(?:can\s+)?access\b/i,
];

const SECRET_REFERENCE = /\{\{\s*(?:secrets?|env|environment)\s*[.[\]]/i;

function authenticationMessage(): string {
  return 'This workflow requires GitHub authentication because it accesses authenticated-user or private account data. FlowCraft does not currently support safe secret references in generated workflows. Configure a GitHub integration outside this generator, or change the prompt to use public issues from a specific owner/repository such as facebook/react.';
}

function authorizationHeader(headers: unknown): string | undefined {
  if (!headers || typeof headers !== 'object') return undefined;
  const entry = Object.entries(headers as Record<string, unknown>)
    .find(([key]) => key.toLowerCase() === 'authorization');
  return typeof entry?.[1] === 'string' ? entry[1].trim() : undefined;
}

function isAuthenticatedUserIssuesEndpoint(config: Record<string, unknown>): boolean {
  if (String(config.method ?? 'GET').toUpperCase() !== 'GET' || typeof config.url !== 'string') return false;
  try {
    const url = new URL(config.url);
    return url.protocol === 'https:'
      && url.hostname.toLowerCase() === 'api.github.com'
      && /^\/issues\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

/** Public repository issue URLs are intentionally not blocked. */
export function isPublicGitHubRepositoryIssuesUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.hostname.toLowerCase() === 'api.github.com'
      && /^\/repos\/[^/]+\/[^/]+\/issues\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

/** Rejects clearly authenticated GitHub intent before spending a provider request. */
export function validatePromptAuthenticationIntent(prompt: string): AIAuthenticationIssue | null {
  if (!/\bgithub\b/i.test(prompt)) return null;
  if (!GITHUB_ACCOUNT_INTENT.some((pattern) => pattern.test(prompt))) return null;
  return { code: 'AI_AUTHENTICATION_REQUIRED', message: authenticationMessage() };
}

/**
 * Validates generated API nodes against the credential model that exists today:
 * headers are persisted literal strings and there is no secrets/environment
 * resolver. Consequently neither invented credentials nor secret-like
 * placeholders are executable or safe.
 */
export function validateGeneratedApiAuthentication(
  workflow: GeneratedWorkflowShape,
): AIAuthenticationIssue[] {
  const issues: AIAuthenticationIssue[] = [];
  for (const node of workflow.nodes.filter((candidate) => candidate.type === 'api_call')) {
    if (!isAuthenticatedUserIssuesEndpoint(node.config)) continue;
    const authorization = authorizationHeader(node.config.headers);
    if (!authorization) {
      issues.push({
        code: 'AI_AUTHENTICATION_REQUIRED',
        apiNodeId: node.id,
        message: authenticationMessage(),
      });
      continue;
    }
    if (SECRET_REFERENCE.test(authorization)) {
      issues.push({
        code: 'AI_UNSUPPORTED_SECRET_REFERENCE',
        apiNodeId: node.id,
        message: 'The generated API Call uses a secret placeholder, but FlowCraft does not currently resolve secrets or environment variables in workflow headers. Remove this workflow and use a public owner/repository endpoint instead.',
      });
      continue;
    }
    issues.push({
      code: 'AI_UNSAFE_EMBEDDED_CREDENTIAL',
      apiNodeId: node.id,
      message: 'The generated API Call contains an Authorization value. AI-generated workflows must never embed credentials. Remove the credential and use a supported public endpoint.',
    });
  }
  return issues;
}
