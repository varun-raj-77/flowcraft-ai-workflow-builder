import { redactText } from '../../../utils/redact';

const SENSITIVE_KEY = /authorization|proxy-authorization|cookie|set-cookie|api[-_]?key|token|password|secret|credential/i;
const MAX_DIAGNOSTIC_DEPTH = 4;
const MAX_DIAGNOSTIC_KEYS = 20;
const MAX_DIAGNOSTIC_ARRAY_ITEMS = 10;
const MAX_DIAGNOSTIC_STRING_LENGTH = 500;

export interface TransformDiagnostic {
  code: 'TRANSFORM_MISSING_INPUT_FIELD' | 'TRANSFORM_INPUT_TYPE_MISMATCH' | 'TRANSFORM_EXECUTION_FAILED';
  message: string;
  originalError: string;
  originalStack?: string;
  transformSource: string;
  failingLine?: number;
  failingColumn?: number;
  runtimeContext: {
    input: unknown;
    prev: unknown;
  };
  nodeId?: string;
  nodeName?: string;
  upstreamNodeId?: string;
  upstreamNodeName?: string;
  referencedPath?: string;
  availableFields: string[];
  suggestion: string;
}

export interface TransformFailure {
  message: string;
  stack?: string;
  prev?: unknown;
}

function segmentsFor(reference: string): string[] {
  return reference.match(/[A-Za-z_$][\w$]*|\d+/g) ?? [];
}

function publicKeys(value: unknown): string[] {
  if (Array.isArray(value)) return [`[array: ${value.length} items]`];
  if (!value || typeof value !== 'object') return [];
  return Object.keys(value as Record<string, unknown>).filter((key) => !SENSITIVE_KEY.test(key)).slice(0, 20);
}

function valueType(value: unknown): string {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

function sanitizeDiagnosticValue(value: unknown, key = '', depth = 0): unknown {
  if (SENSITIVE_KEY.test(key)) return undefined;
  if (typeof value === 'string') {
    const redacted = redactText(value);
    return redacted.length > MAX_DIAGNOSTIC_STRING_LENGTH
      ? `${redacted.slice(0, MAX_DIAGNOSTIC_STRING_LENGTH)}…`
      : redacted;
  }
  if (depth >= MAX_DIAGNOSTIC_DEPTH) {
    if (Array.isArray(value)) return `[array: ${value.length} items]`;
    if (value && typeof value === 'object') return `[object: ${Object.keys(value as Record<string, unknown>).length} keys]`;
    return value;
  }
  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_DIAGNOSTIC_ARRAY_ITEMS)
      .map((item) => sanitizeDiagnosticValue(item, '', depth + 1));
    if (value.length > MAX_DIAGNOSTIC_ARRAY_ITEMS) {
      items.push(`[${value.length - MAX_DIAGNOSTIC_ARRAY_ITEMS} more items]`);
    }
    return items;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([childKey]) => !SENSITIVE_KEY.test(childKey))
        .slice(0, MAX_DIAGNOSTIC_KEYS)
        .map(([childKey, childValue]) => [childKey, sanitizeDiagnosticValue(childValue, childKey, depth + 1)]),
    );
  }
  return value;
}

function sourceLocation(stack: string | undefined): { failingLine?: number; failingColumn?: number } {
  if (!stack) return {};
  const match = stack.match(/flowcraft-transform\.js:(\d+):(\d+)/);
  if (!match) return {};
  // V8's new Function wrapper adds three lines before the supplied body.
  return {
    failingLine: Math.max(1, Number(match[1]) - 3),
    failingColumn: Number(match[2]),
  };
}

function findApiTypeMismatch(input: Record<string, unknown>, originalError: string) {
  if (!/expected (?:an? )?array/i.test(originalError)) return null;
  for (const [nodeId, value] of Object.entries(input)) {
    if (!value || typeof value !== 'object') continue;
    const output = value as Record<string, unknown>;
    if (!('status' in output) || !('data' in output) || Array.isArray(output.data)) continue;
    return {
      nodeId,
      status: typeof output.status === 'number' ? output.status : undefined,
      receivedType: valueType(output.data),
      availableFields: publicKeys(output.data),
    };
  }
  return null;
}

function findMissingReference(code: string, input: Record<string, unknown>) {
  const matches = code.matchAll(/\binput((?:\.[A-Za-z_$][\w$]*|\[(?:'[^']+'|"[^"]+"|\d+)\])+)/g);
  for (const match of matches) {
    const segments = segmentsFor(match[1]);
    let value: unknown = input;
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      const next = Array.isArray(value) && /^\d+$/.test(segment)
        ? value[Number(segment)]
        : value && typeof value === 'object'
          ? (value as Record<string, unknown>)[segment]
          : undefined;
      if (next === undefined || next === null) {
        const referencedPath = `input.${segments.slice(0, index + 1).join('.')}`;
        return {
          referencedPath,
          upstreamNodeId: segments[0],
          availableFields: publicKeys(value),
        };
      }
      value = next;
    }
  }
  return null;
}

export class TransformExecutionError extends Error {
  constructor(public diagnostic: TransformDiagnostic) {
    super(diagnostic.message);
    this.name = 'TransformExecutionError';
  }
}

export function createTransformDiagnostic(
  code: string,
  input: Record<string, unknown>,
  failure: string | TransformFailure,
): TransformDiagnostic {
  const details = typeof failure === 'string' ? { message: failure } : failure;
  const originalError = redactText(details.message);
  const location = sourceLocation(details.stack);
  const common = {
    originalError,
    originalStack: details.stack ? redactText(details.stack) : undefined,
    transformSource: redactText(code),
    ...location,
    runtimeContext: {
      input: sanitizeDiagnosticValue(input),
      prev: sanitizeDiagnosticValue(details.prev ?? {}),
    },
  };
  const typeMismatch = findApiTypeMismatch(input, originalError);
  if (typeMismatch) {
    const status = typeMismatch.status === undefined ? '' : ` (HTTP ${typeMismatch.status})`;
    return {
      code: 'TRANSFORM_INPUT_TYPE_MISMATCH',
      message: `Transform expected an array, but input.${typeMismatch.nodeId}.data contained ${typeMismatch.receivedType}${status}.`,
      ...common,
      upstreamNodeId: typeMismatch.nodeId,
      referencedPath: `input.${typeMismatch.nodeId}.data`,
      availableFields: typeMismatch.availableFields,
      suggestion: typeMismatch.status === 401 || typeMismatch.status === 403
        ? 'Authenticate the API Call, confirm it returns an array, and then run the workflow again.'
        : 'Confirm the API Call returns an array, or update the Transform to handle this response shape.',
    };
  }
  const match = findMissingReference(code, input);
  if (!match) {
    return {
      code: 'TRANSFORM_EXECUTION_FAILED',
      message: 'Transform failed while reading its input.',
      ...common,
      availableFields: [],
      suggestion: 'Review the Transform code and the previous node output, then use an available field.',
    };
  }
  return {
    code: 'TRANSFORM_MISSING_INPUT_FIELD',
    message: `Transform failed because ${match.referencedPath} is unavailable.`,
    ...common,
    upstreamNodeId: match.upstreamNodeId,
    referencedPath: match.referencedPath,
    availableFields: match.availableFields,
    suggestion: 'Update the Transform code to use an available field, or change the API request to return the expected shape.',
  };
}
