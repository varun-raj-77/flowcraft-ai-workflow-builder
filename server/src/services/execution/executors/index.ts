import type { NodeExecutor } from './types';
import { executeStart } from './start.executor';
import { executeApiCall } from './apiCall.executor';
import { executeCondition } from './condition.executor';
import { executeTransform } from './transform.executor';
import { executeDelay } from './delay.executor';
import { executeOutput } from './output.executor';
import { executeEnd } from './end.executor';

const executorRegistry: Record<string, NodeExecutor> = {
  start: executeStart,
  api_call: executeApiCall,
  condition: executeCondition,
  transform: executeTransform,
  delay: executeDelay,
  output: executeOutput,
  end: executeEnd,
};

export function getExecutor(nodeType: string): NodeExecutor {
  const executor = executorRegistry[nodeType];
  if (!executor) {
    throw new Error(`No executor registered for node type: ${nodeType}`);
  }
  return executor;
}
