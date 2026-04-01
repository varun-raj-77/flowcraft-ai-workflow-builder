import type { NodeExecutor } from './types';

export const executeTransform: NodeExecutor = async ({ nodeId, config, context }) => {
  const code = String(config.transformCode || 'return input');

  // Build an input object from all available node outputs
  const allOutputs: Record<string, unknown> = {};
  let prevOutput: unknown = {};
  for (const [id, output] of context.entries()) {
    allOutputs[id] = output;
    prevOutput = output; // Last one becomes 'prev'
  }

  try {
    // 'input' = all outputs keyed by node ID
    // 'prev' = the most recent node's output (convenience alias)
    // 'nodes' = same as input (alias)
    // eslint-disable-next-line no-new-func
    const fn = new Function('input', 'prev', 'nodes', `"use strict"; ${code}`);
    const result = fn(allOutputs, prevOutput, allOutputs);

    const output = (result !== null && result !== undefined && typeof result === 'object')
      ? result as Record<string, unknown>
      : { data: result ?? null };

    return { output };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Transform execution failed: ${message}`);
  }
};
