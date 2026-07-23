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
import type { Workflow, WorkflowNode, WorkflowEdge, NodeType, FlowNodeData, GenerationMetadata } from '@/types';
import { getDefaultConfig, getDefaultLabel } from '@/lib/defaultConfigs';
import { generateId } from '@/lib/utils';
import { hasCompleteGenerationMetadata } from '@/lib/workflowSavePayload';

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
  const conditionBranch = edge.data?.conditionBranch;
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle ?? undefined,
    targetHandle: edge.targetHandle ?? undefined,
    conditionBranch: conditionBranch === 'true' || conditionBranch === 'false'
      ? conditionBranch
      : undefined,
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
  generationMetadata?: GenerationMetadata;
}

interface WorkflowSnapshot {
  nodes: Node<FlowNodeData>[];
  edges: Edge[];
  meta: WorkflowMeta | null;
}

const HISTORY_LIMIT = 40;

function cloneSnapshot(snapshot: WorkflowSnapshot): WorkflowSnapshot {
  return structuredClone(snapshot);
}

function takeSnapshot(state: Pick<WorkflowState, 'nodes' | 'edges' | 'meta'>): WorkflowSnapshot {
  return cloneSnapshot({ nodes: state.nodes, edges: state.edges, meta: state.meta });
}

function snapshotsEqual(a: WorkflowSnapshot, b: WorkflowSnapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function emptySnapshot(): WorkflowSnapshot {
  return { nodes: [], edges: [], meta: null };
}

interface WorkflowState {
  // State — React Flow's native types for zero-conversion rendering
  nodes: Node<FlowNodeData>[];
  edges: Edge[];
  meta: WorkflowMeta | null;
  isDirty: boolean;
  undoStack: WorkflowSnapshot[];
  redoStack: WorkflowSnapshot[];
  savedSnapshot: WorkflowSnapshot;
  dragSnapshot: WorkflowSnapshot | null;

  // React Flow change handlers — passed directly as props
  onNodesChange: OnNodesChange<Node<FlowNodeData>>;
  onEdgesChange: OnEdgesChange;
  onConnect: (connection: Connection) => void;

  // Domain actions
  setWorkflow: (workflow: Workflow) => void;
  clearWorkflow: () => void;
  addNode: (type: NodeType, position: { x: number; y: number }) => string;
  removeNode: (nodeId: string) => void;
  removeNodeAndReconnect: (nodeId: string, connection: Connection) => void;
  removeEdge: (edgeId: string) => void;
  undo: () => void;
  redo: () => void;
  updateNodeData: (nodeId: string, data: Partial<FlowNodeData>) => void;
  updateMeta: (updates: Partial<WorkflowMeta>) => void;
  applyGeneratedWorkflow: (workflow: Pick<Workflow, 'name' | 'description' | 'nodes' | 'edges' | 'generationMetadata'>) => void;
  markClean: () => void;
  setDirty: () => void;

  // Serialization — convert back to our domain types for API calls
  toWorkflowNodes: () => WorkflowNode[];
  toWorkflowEdges: () => WorkflowEdge[];
}

function commitSnapshot(
  state: WorkflowState,
  next: WorkflowSnapshot,
  previous: WorkflowSnapshot = takeSnapshot(state),
): Pick<WorkflowState, 'nodes' | 'edges' | 'meta' | 'isDirty' | 'undoStack' | 'redoStack' | 'dragSnapshot'> {
  return {
    ...next,
    isDirty: !snapshotsEqual(next, state.savedSnapshot),
    undoStack: [...state.undoStack, previous].slice(-HISTORY_LIMIT),
    redoStack: [],
    dragSnapshot: null,
  };
}

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  nodes: [],
  edges: [],
  meta: null,
  isDirty: false,
  undoStack: [],
  redoStack: [],
  savedSnapshot: emptySnapshot(),
  dragSnapshot: null,

  // ── React Flow change handlers ──────────────────────────────
  // These are called by React Flow on every interaction (drag, select, delete).
  // applyNodeChanges/applyEdgeChanges are React Flow utilities that produce
  // the next state immutably. We just pass the result into our store.

  onNodesChange: (changes) => {
    set((state) => {
      const nextNodes = applyNodeChanges(changes, state.nodes);
      const persistent = changes.filter((change) => change.type !== 'select' && change.type !== 'dimensions');
      if (!persistent.length) return { nodes: nextNodes };

      const positionChanges = persistent.filter((change) => change.type === 'position');
      const nonPositionChanges = persistent.filter((change) => change.type !== 'position');
      if (nonPositionChanges.length) return commitSnapshot(state, { nodes: nextNodes, edges: state.edges, meta: state.meta });

      const startedDrag = positionChanges.some((change) => change.type === 'position' && change.dragging === true);
      const endedDrag = positionChanges.some((change) => change.type === 'position' && change.dragging === false);
      if (startedDrag && !state.dragSnapshot) return { nodes: nextNodes, dragSnapshot: takeSnapshot(state) };
      if (endedDrag && state.dragSnapshot) {
        return commitSnapshot(state, { nodes: nextNodes, edges: state.edges, meta: state.meta }, state.dragSnapshot);
      }
      if (state.dragSnapshot) return { nodes: nextNodes };
      return commitSnapshot(state, { nodes: nextNodes, edges: state.edges, meta: state.meta });
    });
  },

  onEdgesChange: (changes) => {
    set((state) => {
      const nextEdges = applyEdgeChanges(changes, state.edges);
      if (!changes.some((change) => change.type !== 'select')) return { edges: nextEdges };
      return commitSnapshot(state, { nodes: state.nodes, edges: nextEdges, meta: state.meta });
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

    set((state) => commitSnapshot(state, { nodes: state.nodes, edges: addEdge(newEdge, state.edges), meta: state.meta }));
  },

  // ── Domain actions ──────────────────────────────────────────

  setWorkflow: (workflow) =>
    set(() => {
      const next: WorkflowSnapshot = {
        nodes: workflow.nodes.map(toFlowNode),
        edges: workflow.edges.map(toFlowEdge),
        meta: {
        _id: workflow._id,
        name: workflow.name,
        description: workflow.description,
        isGeneratedByAI: workflow.isGeneratedByAI,
        generationMetadata: workflow.generationMetadata,
        },
      };
      return { ...next, isDirty: false, undoStack: [], redoStack: [], savedSnapshot: cloneSnapshot(next), dragSnapshot: null };
    }),

  clearWorkflow: () =>
    set(() => ({ ...emptySnapshot(), isDirty: false, undoStack: [], redoStack: [], savedSnapshot: emptySnapshot(), dragSnapshot: null })),

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

    set((state) => commitSnapshot(state, { nodes: [...state.nodes, newNode], edges: state.edges, meta: state.meta }));
    return id;
  },

  removeNode: (nodeId) => {
    set((state) => {
      if (!state.nodes.some((node) => node.id === nodeId)) return state;
      return commitSnapshot(state, {
        nodes: state.nodes.filter((node) => node.id !== nodeId),
        edges: state.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
        meta: state.meta,
      });
    });
  },

  removeNodeAndReconnect: (nodeId, connection) => {
    const sourceNode = get().nodes.find((node) => node.id === connection.source);
    const isCondition = sourceNode?.data.nodeType === 'condition';
    const edge: Edge = {
      ...connection,
      id: generateId('edge'),
      type: 'smoothstep',
      animated: false,
      label: isCondition ? connection.sourceHandle === 'condition_true' ? 'Yes' : 'No' : undefined,
      data: isCondition ? { conditionBranch: connection.sourceHandle === 'condition_true' ? 'true' : 'false' } : undefined,
    };
    set((state) => commitSnapshot(state, {
      nodes: state.nodes.filter((node) => node.id !== nodeId),
      edges: [...state.edges.filter((item) => item.source !== nodeId && item.target !== nodeId), edge],
      meta: state.meta,
    }));
  },

  removeEdge: (edgeId) => set((state) => {
    if (!state.edges.some((edge) => edge.id === edgeId)) return state;
    return commitSnapshot(state, { nodes: state.nodes, edges: state.edges.filter((edge) => edge.id !== edgeId), meta: state.meta });
  }),

  undo: () => set((state) => {
    const snapshot = state.undoStack.at(-1);
    if (!snapshot) return state;
    const current = takeSnapshot(state);
    return { ...cloneSnapshot(snapshot), isDirty: !snapshotsEqual(snapshot, state.savedSnapshot), undoStack: state.undoStack.slice(0, -1), redoStack: [...state.redoStack, current].slice(-HISTORY_LIMIT), dragSnapshot: null };
  }),

  redo: () => set((state) => {
    const snapshot = state.redoStack.at(-1);
    if (!snapshot) return state;
    const current = takeSnapshot(state);
    return { ...cloneSnapshot(snapshot), isDirty: !snapshotsEqual(snapshot, state.savedSnapshot), undoStack: [...state.undoStack, current].slice(-HISTORY_LIMIT), redoStack: state.redoStack.slice(0, -1), dragSnapshot: null };
  }),

  updateNodeData: (nodeId, dataUpdate) => {
    set((state) => {
      const nodes = state.nodes.map((node) =>
        node.id === nodeId
          ? { ...node, data: { ...node.data, ...dataUpdate } }
          : node
      );
      return JSON.stringify(nodes) === JSON.stringify(state.nodes) ? state : commitSnapshot(state, { nodes, edges: state.edges, meta: state.meta });
    });
  },

  updateMeta: (updates) =>
    set((state) => {
      const meta = state.meta ? { ...state.meta, ...updates } : null;
      return JSON.stringify(meta) === JSON.stringify(state.meta) ? state : commitSnapshot(state, { nodes: state.nodes, edges: state.edges, meta });
    }),

  applyGeneratedWorkflow: (workflow) =>
    set((state) => {
      if (!hasCompleteGenerationMetadata(workflow.generationMetadata)) return state;
      return commitSnapshot(state, {
        nodes: workflow.nodes.map(toFlowNode),
        edges: workflow.edges.map(toFlowEdge),
        meta: state.meta ? {
          ...state.meta,
          name: workflow.name,
          description: workflow.description,
          isGeneratedByAI: true,
          generationMetadata: workflow.generationMetadata,
        } : { _id: '', name: workflow.name, description: workflow.description, isGeneratedByAI: true, generationMetadata: workflow.generationMetadata },
      });
    }),

  markClean: () => set((state) => ({ isDirty: false, savedSnapshot: takeSnapshot(state) })),

  setDirty: () => set({ isDirty: true }),

  // ── Serialization ───────────────────────────────────────────

  toWorkflowNodes: () => get().nodes.map(fromFlowNode),
  toWorkflowEdges: () => get().edges.map(fromFlowEdge),
}));
