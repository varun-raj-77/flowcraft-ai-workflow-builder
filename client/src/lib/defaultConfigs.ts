import type { NodeType, NodeConfig } from '@/types';

/**
 * Returns the default config for a given node type.
 * Called when a new node is created from palette drop.
 */
export function getDefaultConfig(type: NodeType): NodeConfig {
  switch (type) {
    case 'start':
      return {};

    case 'api_call':
      return {
        url: 'https://jsonplaceholder.typicode.com/users',
        method: 'GET' as const,
        headers: {},
        timeout: 5000,
      };

    case 'condition':
      return {
        expression: '{{prev.status}} === 200',
      };

    case 'transform':
      return {
        transformCode: 'return input',
        description: '',
      };

    case 'delay':
      return {
        delayMs: 1000,
      };

    case 'output':
      return {
        logLevel: 'info' as const,
        message: '{{prev.data}}',
      };

    case 'end':
      return {};

    default: {
      // Exhaustive check — TypeScript will error if a NodeType case is missing
      const _exhaustive: never = type;
      return _exhaustive;
    }
  }
}

/**
 * Returns the default label for a given node type.
 */
export function getDefaultLabel(type: NodeType): string {
  switch (type) {
    case 'start':     return 'Start';
    case 'api_call':  return 'API Call';
    case 'condition': return 'Condition';
    case 'transform': return 'Transform';
    case 'delay':     return 'Delay';
    case 'output':    return 'Output';
    case 'end':       return 'End';
  }
}
