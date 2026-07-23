import type { NodeType } from './workflow';

export type ExecutionStatus = 'running' | 'completed' | 'failed' | 'cancelled';
export type StepStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped';

export interface TransformDiagnostic {
  code: 'TRANSFORM_MISSING_INPUT_FIELD' | 'TRANSFORM_INPUT_TYPE_MISMATCH' | 'TRANSFORM_EXECUTION_FAILED';
  message: string;
  originalError: string;
  originalStack?: string;
  transformSource?: string;
  failingLine?: number;
  failingColumn?: number;
  runtimeContext?: {
    input: unknown;
    prev: unknown;
  };
  nodeId?: string;
  nodeName?: string;
  upstreamNodeId?: string;
  upstreamNodeName?: string;
  referencedPath?: string;
  availableFields: string[];
  suggestion: string;
}

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
  diagnostic?: TransformDiagnostic;
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
