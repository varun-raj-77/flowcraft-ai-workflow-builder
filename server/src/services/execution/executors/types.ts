import type { ExecutionContext } from '../templateEngine';

/**
 * Input passed to every executor.
 */
export interface ExecutorInput {
  nodeId: string;
  config: Record<string, unknown>;
  context: ExecutionContext;
}

/**
 * Result returned by every executor.
 */
export interface ExecutorResult {
  output: Record<string, unknown>;
}

/**
 * The function signature every node type executor must satisfy.
 */
export type NodeExecutor = (input: ExecutorInput) => Promise<ExecutorResult>;
