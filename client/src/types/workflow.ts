// ============================================================
// Node Types & Configs
// ============================================================

export type NodeType = 'start' | 'api_call' | 'condition' | 'transform' | 'delay' | 'output' | 'end';

export type StartConfig = {
  readonly [key: string]: unknown;
  // Start node has no configuration — it's the entry point
}

export type ApiCallConfig = {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers: Record<string, string>;
  body?: string;
  timeout?: number;
};

export type ConditionConfig = {
  expression: string;
  trueTargetNodeId?: string;
  falseTargetNodeId?: string;
};

export type TransformConfig = {
  transformCode: string;
  description?: string;
};

export type DelayConfig = {
  delayMs: number;
};

export type OutputConfig = {
  logLevel: 'info' | 'warn' | 'error';
  message: string;
};

export type EndConfig = {
  readonly [key: string]: unknown;
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
export interface FlowNodeData extends Record<string, unknown> {
  label: string;
  nodeType: NodeType;
  config: NodeConfig;
  description?: string;
  comparisonStatus?: 'added' | 'modified' | 'layout' | 'removed';
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
  generationMetadata?: GenerationMetadata;
  /** Present for workflows migrated to immutable backend revisions. */
  currentRevision?: number;
  currentRevisionId?: string;
  definitionHash?: string;
  createdAt: string;
  updatedAt: string;
}

/** Lightweight dashboard response; graph arrays are intentionally omitted. */
export interface WorkflowSummary {
  _id: string;
  userId: string;
  name: string;
  description?: string;
  isGeneratedByAI: boolean;
  generationMetadata?: GenerationMetadata;
  currentRevision?: number;
  currentRevisionId?: string;
  definitionHash?: string;
  createdAt: string;
  updatedAt: string;
  nodeCount?: number;
  lastExecutionStatus?: 'running' | 'completed' | 'failed' | 'cancelled' | null;
}

export interface CapabilityCoverage {
  requestedCapabilities: string[];
  implementedCapabilities: string[];
  missingCapabilities: string[];
  unsupportedCapabilities: string[];
  coverage: number;
  isComplete: boolean;
}

export interface GenerationMetadata {
  originalPrompt: string;
  generatedAt: string;
  provider?: string;
  model?: string;
  capabilityCoverage?: CapabilityCoverage;
}

export type WorkflowRevisionSource = 'manual' | 'ai_generated' | 'restore';

export interface WorkflowRevisionSummary {
  id: string;
  revision: number;
  parentRevisionId: string | null;
  source: WorkflowRevisionSource;
  definitionHash: string;
  restoredFromRevisionId?: string;
  restoredFromRevision?: number;
  createdAt: string;
  nodeCount: number;
  edgeCount: number;
}

export interface WorkflowRevisionDetail {
  id: string;
  workflowId: string;
  revision: number;
  parentRevisionId: string | null;
  source: WorkflowRevisionSource;
  definitionHash: string;
  restoredFromRevisionId?: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  generationMetadata?: GenerationMetadata;
  createdAt: string;
}

export interface RevisionHistoryResponse {
  revisions: WorkflowRevisionSummary[];
  nextBeforeRevision: number | null;
}

export interface RestoreWorkflowRevisionRequest {
  expectedRevision: number;
}

export type RestoreWorkflowRevisionResponse = Workflow;

export type WorkflowAiPromptContext =
  | {
    status: 'available';
    prompt: string;
    promptRevision: number;
    currentRevision: number;
    relationship: 'direct' | 'inherited' | 'restored';
    provider?: string;
    model?: string;
  }
  | { status: 'none'; currentRevision: number }
  | { status: 'unavailable'; currentRevision: number; message: string };

export interface RegenerateWorkflowRequest {
  prompt: string;
  expectedRevision: number;
}

export type WorkflowChangeCategory = 'runtime' | 'presentation' | 'layout';

export interface WorkflowFieldChange {
  path: string;
  category: WorkflowChangeCategory;
  beforePresent: boolean;
  afterPresent: boolean;
  before?: unknown;
  after?: unknown;
}

export interface WorkflowComparisonRevision {
  id: string;
  revision: number;
  source: WorkflowRevisionSource;
  definitionHash: string;
  createdAt: string;
}

export interface WorkflowRevisionComparison {
  workflowId: string;
  from: WorkflowComparisonRevision;
  to: WorkflowComparisonRevision;
  hasChanges: boolean;
  summary: {
    totalChanges: number;
    nodes: { added: number; removed: number; modified: number };
    edges: { added: number; removed: number; modified: number };
  };
  nodes: {
    added: Array<{ nodeId: string; node: WorkflowNode }>;
    removed: Array<{ nodeId: string; node: WorkflowNode }>;
    modified: Array<{
      nodeId: string;
      before: WorkflowNode;
      after: WorkflowNode;
      changes: WorkflowFieldChange[];
      changesTruncated: boolean;
    }>;
  };
  edges: {
    added: Array<{ edgeKey: string; edge: WorkflowEdge }>;
    removed: Array<{ edgeKey: string; edge: WorkflowEdge }>;
    modified: Array<{
      edgeKey: string;
      before: WorkflowEdge;
      after: WorkflowEdge;
      changes: WorkflowFieldChange[];
      changesTruncated: boolean;
    }>;
  };
  graph: { nodes: WorkflowNode[]; edges: WorkflowEdge[] };
}
