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

/**
 * Output nodes often surround JSON templates with prose. Walk balanced JSON
 * fragments (respecting escaped quotes) and scrub them structurally as well.
 * Bound extra parsing work; the inline rules below still apply to large text.
 */
function redactEmbeddedJson(value: string): string {
  if (value.length > 256 * 1024 || !SENSITIVE_KEY.test(value)) return value;
  let safe = '';
  let preservedFrom = 0;
  let start = -1;
  let closers: string[] = [];
  let inString = false;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (start < 0) {
      if (character === '{' || character === '[') {
        start = index;
        closers = [character === '{' ? '}' : ']'];
      }
      continue;
    }
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === '{' || character === '[') closers.push(character === '{' ? '}' : ']');
    else if (character === '}' || character === ']') {
      if (closers.pop() !== character) {
        start = -1;
        closers = [];
        continue;
      }
      if (closers.length !== 0) continue;
      try {
        const parsed: unknown = JSON.parse(value.slice(start, index + 1));
        if (parsed && typeof parsed === 'object') {
          const cleaned = redactSecrets(parsed);
          if (JSON.stringify(parsed) !== JSON.stringify(cleaned)) {
            safe += value.slice(preservedFrom, start) + JSON.stringify(cleaned);
            preservedFrom = index + 1;
          }
        }
      } catch {
        // Not actually JSON: inline masking is still applied afterwards.
      }
      start = -1;
    }
  }
  return safe + value.slice(preservedFrom);
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
  return redactInlineText(redactEmbeddedJson(safe));
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
