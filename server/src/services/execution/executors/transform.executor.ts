import { buildExecutionInputs } from '../templateEngine';
import type { NodeExecutor } from './types';
import { createTransformDiagnostic, TransformExecutionError } from './transformDiagnostics';
import { executeIsolatedScript, IsolatedScriptError } from './isolatedScriptRunner';

export const executeTransform: NodeExecutor = async ({ config, context }) => {
  const code = String(config.transformCode || 'return input');

  const executionInputs = buildExecutionInputs(context);

  try {
    // Isolated QuickJS/WebAssembly: no Node process, filesystem or network globals.
    const result = await executeIsolatedScript('transform', code, executionInputs);

    const output = (result !== null && result !== undefined && typeof result === 'object')
      ? result as Record<string, unknown>
      : { data: result ?? null };

    return { output };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new TransformExecutionError(createTransformDiagnostic(code, executionInputs.input, {
      message,
      stack: err instanceof IsolatedScriptError ? err.guestStack : err instanceof Error ? err.stack : undefined,
      prev: executionInputs.prev,
    }));
  }
};
