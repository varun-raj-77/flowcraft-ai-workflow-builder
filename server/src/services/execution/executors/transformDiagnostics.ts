const SENSITIVE_KEY = /authorization|proxy-authorization|cookie|set-cookie|api[-_]?key|token|password|secret|credential/i;

export interface TransformDiagnostic {
  code: 'TRANSFORM_MISSING_INPUT_FIELD';
  message: string;
  originalError: string;
  nodeId?: string;
  nodeName?: string;
  upstreamNodeId?: string;
  upstreamNodeName?: string;
  referencedPath?: string;
  availableFields: string[];
  suggestion: string;
}

function segmentsFor(reference: string): string[] {
  return reference.match(/[A-Za-z_$][\w$]*|\d+/g) ?? [];
}

function publicKeys(value: unknown): string[] {
  if (Array.isArray(value)) return [`[array: ${value.length} items]`];
  if (!value || typeof value !== 'object') return [];
  return Object.keys(value as Record<string, unknown>).filter((key) => !SENSITIVE_KEY.test(key)).slice(0, 20);
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

export function createTransformDiagnostic(code: string, input: Record<string, unknown>, originalError: string): TransformDiagnostic {
  const match = findMissingReference(code, input);
  if (!match) {
    return {
      code: 'TRANSFORM_MISSING_INPUT_FIELD',
      message: 'Transform failed while reading its input.',
      originalError,
      availableFields: [],
      suggestion: 'Review the Transform code and the previous node output, then use an available field.',
    };
  }
  return {
    code: 'TRANSFORM_MISSING_INPUT_FIELD',
    message: `Transform failed because ${match.referencedPath} is unavailable.`,
    originalError,
    upstreamNodeId: match.upstreamNodeId,
    referencedPath: match.referencedPath,
    availableFields: match.availableFields,
    suggestion: 'Update the Transform code to use an available field, or change the API request to return the expected shape.',
  };
}
