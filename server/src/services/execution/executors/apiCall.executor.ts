import { resolveTemplates, type ExecutionContext } from '../templateEngine';
import type { NodeExecutor } from './types';

export const executeApiCall: NodeExecutor = async ({ config, context }) => {
  const url = resolveTemplates(String(config.url || ''), context);
  const method = String(config.method || 'GET');
  const headers = (config.headers || {}) as Record<string, string>;
  const body = config.body ? resolveTemplates(String(config.body), context) : undefined;
  const timeout = Number(config.timeout) || 5000;

  // Resolve template variables in header values
  const resolvedHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    resolvedHeaders[key] = resolveTemplates(value, context);
  }

  // Validate URL before making the request
  if (!url || url === 'undefined') {
    throw new Error('API Call URL is empty or undefined');
  }

  try {
    new URL(url);
  } catch {
    throw new Error(`Invalid URL: "${url}". Must be a fully qualified URL starting with http:// or https://`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      method,
      headers: resolvedHeaders,
      body: method !== 'GET' ? body : undefined,
      signal: controller.signal,
    });

    let data: unknown;
    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    // Capture response headers as plain object
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    return {
      output: {
        status: response.status,
        data,
        headers: responseHeaders,
      },
    };
  } catch (err: unknown) {
    if (err instanceof Error) {
      if (err.name === 'AbortError') {
        throw new Error(`Request to ${url} timed out after ${timeout}ms`);
      }
      // Network errors (DNS failure, connection refused, etc.)
      if (err.message === 'fetch failed' || err.message.includes('ENOTFOUND') || err.message.includes('ECONNREFUSED')) {
        throw new Error(`Could not reach ${url}. The server may be down or the URL may be invalid.`);
      }
      throw new Error(`API Call to ${url} failed: ${err.message}`);
    }
    throw new Error(`API Call to ${url} failed with an unknown error`);
  } finally {
    clearTimeout(timer);
  }
};
