import { buildExecutionInputs } from '../templateEngine';
import type { NodeExecutor } from './types';
import { createTransformDiagnostic, TransformExecutionError } from './transformDiagnostics';

export const executeTransform: NodeExecutor = async ({ config, context }) => {
  const code = String(config.transformCode || 'return input');

  const executionInputs = buildExecutionInputs(context);

  try {
    // 'input' = all outputs keyed by node ID
    // 'prev' = the most recent node's output (convenience alias)
    // 'nodes' = same as input (alias)
    // eslint-disable-next-line no-new-func
    const fn = new Function(
      'input',
      'prev',
      'nodes',
      `"use strict";\n${code}\n//# sourceURL=flowcraft-transform.js`,
    );
    const result = fn(executionInputs.input, executionInputs.prev, executionInputs.nodes);

    const output = (result !== null && result !== undefined && typeof result === 'object')
      ? result as Record<string, unknown>
      : { data: result ?? null };

    return { output };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new TransformExecutionError(createTransformDiagnostic(code, executionInputs.input, {
      message,
      stack: err instanceof Error ? err.stack : undefined,
      prev: executionInputs.prev,
    }));
  }
};
