import { create } from 'zustand';
import {
  type Node,
  type Edge,
  type OnNodesChange,
  type OnEdgesChange,
  type Connection,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
} from '@xyflow/react';
import type { Workflow, WorkflowNode, WorkflowEdge, NodeType, FlowNodeData } from '@/types';
import { getDefaultConfig, getDefaultLabel } from '@/lib/defaultConfigs';
import { generateId } from '@/lib/utils';

// ============================================================
// Conversion between our domain types and React Flow's types
// ============================================================

/**
 * Convert our WorkflowNode → React Flow Node.
 * React Flow expects: { id, type, position, data }
 * We use `type` as the React Flow node type string (maps to nodeTypes registry).
 * All our domain data goes into `data`.
 */
function toFlowNode(node: WorkflowNode): Node<FlowNodeData> {
  return {
    id: node.id,
    type: node.type,            // This maps to the custom component in nodeTypes.ts
    position: node.position,
    data: {
      label: node.label,
      nodeType: node.type,
      config: node.config,
      description: node.description,
    },
  };
}

/**
 * Convert our WorkflowEdge → React Flow Edge.
 * Our edge shape is already very close to React Flow's.
 */
function toFlowEdge(edge: WorkflowEdge): Edge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
    label: edge.label,
    type: 'smoothstep',
    animated: false,
    data: { conditionBranch: edge.conditionBranch },
  };
}

/**
 * Convert React Flow Node back → our WorkflowNode for persistence.
 */
function fromFlowNode(node: Node<FlowNodeData>): WorkflowNode {
  return {
    id: node.id,
    type: node.data.nodeType,
    label: node.data.label,
    position: node.position,
    config: node.data.config || {},
    description: node.data.description,
  };
}

/**
 * Convert React Flow Edge back → our WorkflowEdge for persistence.
 */
function fromFlowEdge(edge: Edge): WorkflowEdge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle ?? undefined,
    targetHandle: edge.targetHandle ?? undefined,
    conditionBranch: edge.data?.conditionBranch,
    label: typeof edge.label === 'string' ? edge.label : undefined,
  };
}

// ============================================================
// Store
// ============================================================

interface WorkflowMeta {
  _id: string;
  name: string;
  description?: string;
  isGeneratedByAI: boolean;
}

interface WorkflowState {
  // State — React Flow's native types for zero-conversion rendering
  nodes: Node<FlowNodeData>[];
  edges: Edge[];
  meta: WorkflowMeta | null;
  isDirty: boolean;

  // React Flow change handlers — passed directly as props
  onNodesChange: OnNodesChange<Node<FlowNodeData>>;
  onEdgesChange: OnEdgesChange;
  onConnect: (connection: Connection) => void;

  // Domain actions
  setWorkflow: (workflow: Workflow) => void;
  clearWorkflow: () => void;
  addNode: (type: NodeType, position: { x: number; y: number }) => void;
  removeNode: (nodeId: string) => void;
  updateNodeData: (nodeId: string, data: Partial<FlowNodeData>) => void;
  updateMeta: (updates: Partial<WorkflowMeta>) => void;
  markClean: () => void;
  setDirty: () => void;

  // Serialization — convert back to our domain types for API calls
  toWorkflowNodes: () => WorkflowNode[];
  toWorkflowEdges: () => WorkflowEdge[];
}

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  nodes: [],
  edges: [],
  meta: null,
  isDirty: false,

  // ── React Flow change handlers ──────────────────────────────
  // These are called by React Flow on every interaction (drag, select, delete).
  // applyNodeChanges/applyEdgeChanges are React Flow utilities that produce
  // the next state immutably. We just pass the result into our store.

  onNodesChange: (changes) => {
    set({
      nodes: applyNodeChanges(changes, get().nodes),
      isDirty: true,
    });
  },

  onEdgesChange: (changes) => {
    set({
      edges: applyEdgeChanges(changes, get().edges),
      isDirty: true,
    });
  },

  onConnect: (connection) => {
    // Determine if source is a condition node to set label + conditionBranch
    const sourceNode = get().nodes.find((n) => n.id === connection.source);
    const isCondition = sourceNode?.data.nodeType === 'condition';

    const newEdge: Edge = {
      ...connection,
      id: generateId('edge'),
      type: 'smoothstep',
      animated: false,
      label: isCondition
        ? connection.sourceHandle === 'condition_true' ? 'Yes' : 'No'
        : undefined,
      data: isCondition
        ? { conditionBranch: connection.sourceHandle === 'condition_true' ? 'true' : 'false' }
        : undefined,
    };

    set({
      edges: addEdge(newEdge, get().edges),
      isDirty: true,
    });
  },

  // ── Domain actions ──────────────────────────────────────────

  setWorkflow: (workflow) =>
    set({
      nodes: workflow.nodes.map(toFlowNode),
      edges: workflow.edges.map(toFlowEdge),
      meta: {
        _id: workflow._id,
        name: workflow.name,
        description: workflow.description,
        isGeneratedByAI: workflow.isGeneratedByAI,
      },
      isDirty: false,
    }),

  clearWorkflow: () =>
    set({ nodes: [], edges: [], meta: null, isDirty: false }),

  addNode: (type, position) => {
    const id = generateId('node');
    const newNode: Node<FlowNodeData> = {
      id,
      type,
      position,
      data: {
        label: getDefaultLabel(type),
        nodeType: type,
        config: getDefaultConfig(type),
      },
    };

    set({
      nodes: [...get().nodes, newNode],
      isDirty: true,
    });
  },

  removeNode: (nodeId) => {
    set({
      nodes: get().nodes.filter((n) => n.id !== nodeId),
      // Also remove any edges connected to this node
      edges: get().edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
      isDirty: true,
    });
  },

  updateNodeData: (nodeId, dataUpdate) => {
    set({
      nodes: get().nodes.map((node) =>
        node.id === nodeId
          ? { ...node, data: { ...node.data, ...dataUpdate } }
          : node
      ),
      isDirty: true,
    });
  },

  updateMeta: (updates) =>
    set((state) => ({
      meta: state.meta ? { ...state.meta, ...updates } : null,
      isDirty: true,
    })),

  markClean: () => set({ isDirty: false }),

  setDirty: () => set({ isDirty: true }),

  // ── Serialization ───────────────────────────────────────────

  toWorkflowNodes: () => get().nodes.map(fromFlowNode),
  toWorkflowEdges: () => get().edges.map(fromFlowEdge),
}));
