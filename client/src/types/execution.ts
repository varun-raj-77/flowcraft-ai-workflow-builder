import type { NodeType } from './workflow';

export type ExecutionStatus = 'running' | 'completed' | 'failed' | 'cancelled';
export type StepStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped';

export interface StepLog {
  nodeId: string;
  nodeType: NodeType;
  nodeLabel: string;
  status: StepStatus;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
}

export interface ExecutionRun {
  _id: string;
  workflowId: string;
  userId: string;
  status: ExecutionStatus;
  startedAt: string;
  completedAt?: string;
  triggerType: 'manual' | 'ai_generated';
  error?: string;
  stepLogs: StepLog[];
  executionOrder: string[];
  createdAt: string;
  updatedAt: string;
}
