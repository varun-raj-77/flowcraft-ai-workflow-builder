import type { NodeExecutor } from './types';

export const executeEnd: NodeExecutor = async () => {
  return { output: {} };
};
