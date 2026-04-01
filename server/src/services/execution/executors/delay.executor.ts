import type { NodeExecutor } from './types';

export const executeDelay: NodeExecutor = async ({ config }) => {
  const delayMs = Number(config.delayMs) || 0;

  await new Promise((resolve) => setTimeout(resolve, delayMs));

  return {
    output: {
      delayedMs: delayMs,
    },
  };
};
