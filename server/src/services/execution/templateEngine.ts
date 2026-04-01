/**
 * Execution context: maps nodeId → that node's output.
 * Built up as nodes execute. Each executor reads from this and writes to it.
 */
export type ExecutionContext = Map<string, Record<string, unknown>>;

/**
 * Resolves all {{nodeId.path}} templates in a string against the context.
 * 
 * Supports:
 *   {{node_1.status}}      → looks up node_1's output.status
 *   {{node_1.data.name}}   → nested path access
 *   {{prev.status}}        → alias for the most recently executed node's output
 *
 * Unresolved templates are replaced with empty string (not left as raw {{}}
 * which would cause syntax errors in new Function()).
 */
export function resolveTemplates(
  template: string,
  context: ExecutionContext,
): string {
  return template.replace(/\{\{(.+?)\}\}/g, (_match, path: string) => {
    const trimmed = path.trim();
    const segments = trimmed.split('.');

    let rootKey = segments[0];
    const fieldPath = segments.slice(1);

    // 'prev' alias: resolve to the last entry in the context map
    if (rootKey === 'prev') {
      const keys = Array.from(context.keys());
      if (keys.length === 0) return '';
      rootKey = keys[keys.length - 1];
    }

    const nodeOutput = context.get(rootKey);
    if (!nodeOutput) return ''; // Return empty instead of leaving raw {{}} 

    let value: unknown = nodeOutput;
    for (const segment of fieldPath) {
      if (value === null || value === undefined) break;
      value = (value as Record<string, unknown>)[segment];
    }

    if (value === undefined || value === null) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  });
}

/**
 * Resolves templates in all string values of a config object (shallow).
 * Non-string values pass through unchanged.
 */
export function resolveConfigTemplates<T extends Record<string, unknown>>(
  config: T,
  context: ExecutionContext,
): T {
  const resolved = { ...config };

  for (const [key, value] of Object.entries(resolved)) {
    if (typeof value === 'string') {
      (resolved as Record<string, unknown>)[key] = resolveTemplates(value, context);
    }
  }

  return resolved;
}

/**
 * Truncates an object's JSON representation to maxBytes.
 * Prevents a single large API response from bloating the execution document.
 */
export function truncateOutput(
  data: Record<string, unknown>,
  maxBytes: number = 50_000,
): Record<string, unknown> {
  const json = JSON.stringify(data);
  if (json.length <= maxBytes) return data;

  return {
    _truncated: true,
    _originalSize: json.length,
    _preview: json.slice(0, maxBytes),
  };
}
