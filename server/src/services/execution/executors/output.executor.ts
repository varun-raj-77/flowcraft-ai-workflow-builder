import { resolveTemplates, type ExecutionContext } from '../templateEngine';
import type { NodeExecutor } from './types';

export const executeOutput: NodeExecutor = async ({ config, context }) => {
  const logLevel = String(config.logLevel || 'info');
  const rawMessage = String(config.message || '');
  const message = resolveTemplates(rawMessage, context);

  // Log to server console for observability
  const prefix = `[workflow:${logLevel.toUpperCase()}]`;
  switch (logLevel) {
    case 'warn':
      console.warn(prefix, message);
      break;
    case 'error':
      console.error(prefix, message);
      break;
    default:
      console.log(prefix, message);
  }

  return {
    output: {
      logLevel,
      message,
    },
  };
};
