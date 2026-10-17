import { buildExecutionInputs, resolveTemplates } from '../templateEngine';
import type { NodeExecutor } from './types';
import { redactText } from '../../../utils/redact';
import { executeIsolatedScript, IsolatedScriptError } from './isolatedScriptRunner';

export const executeCondition: NodeExecutor = async ({ config, context }) => {
  const rawExpression = String(config.expression || 'false');
  const resolved = resolveTemplates(rawExpression, context);

  // Safety: if expression resolved to empty or still has template syntax, default to false
  if (!resolved.trim() || resolved.includes('{{')) {
    return {
      output: {
        result: false,
        branchTaken: 'false' as const,
        resolvedExpression: redactText(resolved),
        note: 'Expression could not be fully resolved, defaulting to false',
      },
    };
  }

  let result: boolean;
  try {
    const executionInputs = buildExecutionInputs(context);
    result = Boolean(await executeIsolatedScript('condition', resolved, executionInputs));
  } catch (err: unknown) {
    // Expression errors preserve the legacy false-branch behavior. Worker crashes,
    // resource exhaustion and timeouts MUST stop the workflow, not choose a path.
    if (!(err instanceof IsolatedScriptError) || err.code !== 'SCRIPT_GUEST_ERROR') throw err;
    const message = redactText(err.message);
    console.warn(`[condition] Isolated expression evaluation failed: ${message}`);
    return {
      output: {
        result: false,
        branchTaken: 'false' as const,
        resolvedExpression: redactText(resolved),
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
