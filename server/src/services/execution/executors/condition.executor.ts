import { buildExecutionInputs, resolveTemplates } from '../templateEngine';
import type { NodeExecutor } from './types';
import { redactText } from '../../../utils/redact';

export const executeCondition: NodeExecutor = async ({ config, context }) => {
  const rawExpression = String(config.expression || 'false');
  const resolved = resolveTemplates(rawExpression, context);

  // Safety: if expression resolved to empty or still has template syntax, default to false
  if (!resolved.trim() || resolved.includes('{{')) {
    return {
      output: {
        result: false,
        branchTaken: 'false' as const,
        resolvedExpression: resolved,
        note: 'Expression could not be fully resolved, defaulting to false',
      },
    };
  }

  let result: boolean;
  try {
    const executionInputs = buildExecutionInputs(context);
    // eslint-disable-next-line no-new-func
    const fn = new Function('input', 'prev', 'nodes', `"use strict"; return (${resolved})`);
    result = Boolean(fn(executionInputs.input, executionInputs.prev, executionInputs.nodes));
  } catch (err: unknown) {
    // Instead of crashing, log the error and default to false
    const message = redactText(err instanceof Error ? err.message : String(err));
    console.warn(`[condition] Expression eval failed: ${message} | Expression: ${redactText(resolved)}`);
    return {
      output: {
        result: false,
        branchTaken: 'false' as const,
        resolvedExpression: resolved,
        evalError: message,
      },
    };
  }

  return {
    output: {
      result,
      branchTaken: result ? 'true' : 'false',
      resolvedExpression: resolved,
    },
  };
};
