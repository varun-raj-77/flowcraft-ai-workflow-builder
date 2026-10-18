const SENSITIVE_KEY = /authorization|proxy-authorization|cookie|set-cookie|api[-_]?key|token|password|secret|credential/i;

/**
 * Mask credential-shaped fragments inside ordinary messages, embedded JSON,
 * stack traces and user-authored Output templates. Preserve quoted JSON value
 * delimiters so inline objects remain readable (and valid when already JSON).
 */
function redactInlineText(value: string): string {
  return value
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)[^@\s/]+@/gi, '$1[REDACTED]@')
    .replace(/\b(Bearer\s+)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/(["'])([^"']+)\1(\s*:\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,}\]]+)/g,
      (match, quote: string, key: string, separator: string) => SENSITIVE_KEY.test(key)
        ? quote + key + quote + separator + quote + '[REDACTED]' + quote
        : match)
    .replace(/\b(api[-_ ]?key|token|password|secret|credential)\s*[:=]\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}\]]+)/gi,
      '$1=[REDACTED]');
}

export function redactText(value: string): string {
  // A full JSON object/array can contain sensitive objects, arrays and nested
  // JSON strings. Redact structurally when possible, including sensitive keys
  // whose values are not strings. Keep original formatting if nothing changed.
  let safe = value;
  const trimmed = value.trim();
  if ((trimmed.startsWith('{') && trimmed.endsWith('}'))
    || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed && typeof parsed === 'object') {
        const cleaned = redactSecrets(parsed);
        if (JSON.stringify(parsed) !== JSON.stringify(cleaned)) safe = JSON.stringify(cleaned);
      }
    } catch {
      // Embedded fragments and malformed JSON still receive inline masking.
    }
  }
  return redactInlineText(safe);
}

/** Redacts common credential fields before data is persisted to execution logs. */
export function redactSecrets(value: unknown, key = ''): unknown {
  if (SENSITIVE_KEY.test(key)) return '[REDACTED]';
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([childKey, childValue]) => [childKey, redactSecrets(childValue, childKey)]),
    );
  }
  return value;
}
