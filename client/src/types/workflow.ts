// ============================================================
// Node Types & Configs
// ============================================================

export type NodeType = 'start' | 'api_call' | 'condition' | 'transform' | 'delay' | 'output' | 'end';

export interface StartConfig {
  // Start node has no configuration — it's the entry point
}

export interface ApiCallConfig {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers: Record<string, string>;
  body?: string;
  timeout?: number;
}

export interface ConditionConfig {
  expression: string;
  trueTargetNodeId?: string;
  falseTargetNodeId?: string;
}

export interface TransformConfig {
  transformCode: string;
  description?: string;
}

export interface DelayConfig {
  delayMs: number;
}

export interface OutputConfig {
  logLevel: 'info' | 'warn' | 'error';
  message: string;
}

export interface EndConfig {
  // End node has no configuration — it's the terminal point
}

export type NodeConfig =
  | StartConfig
  | ApiCallConfig
  | ConditionConfig
  | TransformConfig
  | DelayConfig
  | OutputConfig
  | EndConfig;

// ============================================================
// Node & Edge (our domain types)
// ============================================================

export interface WorkflowNode {
  id: string;
  type: NodeType;
  label: string;
  position: { x: number; y: number };
  config: NodeConfig;
  description?: string;
}

export type EdgeConditionBranch = 'true' | 'false';

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  conditionBranch?: EdgeConditionBranch;
  label?: string;
}

// ============================================================
// React Flow bridge types
// ============================================================

/**
 * The `data` payload passed into every React Flow custom node component.
 * React Flow wraps our domain node as: { id, type, position, data: FlowNodeData }
 * Custom node components receive this via props.data.
 */
export interface FlowNodeData {
  label: string;
  nodeType: NodeType;
  config: NodeConfig;
  description?: string;
}

// ============================================================
// Workflow Document
// ============================================================

export interface Workflow {
  _id: string;
  userId: string;
  name: string;
  description?: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  isGeneratedByAI: boolean;
  createdAt: string;
  updatedAt: string;
}
