import { resolveTemplates } from '../templateEngine';
import type { NodeExecutor } from './types';
import { requestPublicHttp } from './publicHttpTransport';
import { redactText } from '../../../utils/redact';

export const executeApiCall: NodeExecutor = async ({ config, context }) => {
  const url = resolveTemplates(String(config.url || ''), context);
  const method = String(config.method || 'GET').toUpperCase();
  const headers = (config.headers || {}) as Record<string, string>;
  const body = config.body ? resolveTemplates(String(config.body), context) : undefined;
  const timeoutMs = config.timeout === undefined ? 5000 : Number(config.timeout);

  const resolvedHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value !== 'string') throw new Error('API Call headers must be strings.');
    resolvedHeaders[key] = resolveTemplates(value, context);
  }

  if (!url || url === 'undefined') {
    throw new Error('API Call URL is empty or undefined');
  }
  try {
    const response = await requestPublicHttp(url, {
      method,
      headers: resolvedHeaders,
      body,
      timeoutMs,
    });
    return { output: response };
  } catch (err: unknown) {
    // Avoid putting URL paths, query credentials, or raw network errors in run logs.
    const message = err instanceof Error ? err.message : 'An unknown API Call error occurred.';
    throw new Error(redactText(message));
  }
};
