'use client';

import { useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  type NodeMouseHandler,
  type IsValidConnection,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { useWorkflowStore } from '@/stores/workflowStore';
import { useUIStore } from '@/stores/uiStore';
import { nodeTypes } from './nodes/nodeTypes';
import { useDragAndDrop } from './hooks/useDragAndDrop';

/**
 * WorkflowCanvas — the centerpiece of the editor.
 *
 * State ownership:
 *   workflowStore owns nodes[] and edges[] (React Flow reads these as controlled props)
 *   workflowStore.onNodesChange / onEdgesChange / onConnect handle all mutations
 *   uiStore.selectNode tracks which node is selected (drives the config panel)
 *
 * This component has ZERO local state. Everything flows through the stores.
 * React Flow never owns state independently — it's fully controlled.
 */
export function WorkflowCanvas() {
  // ── Store bindings ────────────────────────────────────────
  const nodes = useWorkflowStore((s) => s.nodes);
  const edges = useWorkflowStore((s) => s.edges);
  const onNodesChange = useWorkflowStore((s) => s.onNodesChange);
  const onEdgesChange = useWorkflowStore((s) => s.onEdgesChange);
  const onConnect = useWorkflowStore((s) => s.onConnect);

  const selectNode = useUIStore((s) => s.selectNode);

  // ── Drag and drop from palette ────────────────────────────
  const { onDragOver, onDrop } = useDragAndDrop();

  // ── Node click → select for config panel ──────────────────
  const onNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      selectNode(node.id);
    },
    [selectNode],
  );

  // ── Click on empty canvas → deselect ──────────────────────
  const onPaneClick = useCallback(() => {
    selectNode(null);
  }, [selectNode]);

  // ── Connection validation ─────────────────────────────────
  // Prevents: self-connections, connecting to Start (no input), connecting from End (no output)
  const isValidConnection: IsValidConnection = useCallback(
    (connection) => {
      // No self-connections
      if (connection.source === connection.target) return false;

      const sourceNode = nodes.find((n) => n.id === connection.source);
      const targetNode = nodes.find((n) => n.id === connection.target);

      // Can't connect FROM an end node
      if (sourceNode?.data.nodeType === 'end') return false;

      // Can't connect TO a start node
      if (targetNode?.data.nodeType === 'start') return false;

      // Prevent duplicate edges between same source handle → target
      const existingEdge = edges.find(
        (e) =>
          e.source === connection.source &&
          e.target === connection.target &&
          (e.sourceHandle ?? null) === (connection.sourceHandle ?? null),
      );
      if (existingEdge) return false;

      return true;
    },
    [nodes, edges],
  );

  // ── Keyboard shortcuts ────────────────────────────────────
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Delete' || event.key === 'Backspace') {
        const selectedNodeId = useUIStore.getState().selectedNodeId;
        if (selectedNodeId) {
          useWorkflowStore.getState().removeNode(selectedNodeId);
          selectNode(null);
        }
      }
    },
    [selectNode],
  );

  return (
    <div className="relative flex-1" onKeyDown={onKeyDown} tabIndex={0}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onDragOver={onDragOver}
        onDrop={onDrop}
        isValidConnection={isValidConnection}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        defaultEdgeOptions={{
          type: 'smoothstep',
          animated: false,
        }}
        proOptions={{ hideAttribution: true }}
        className="bg-zinc-50 dark:bg-zinc-950"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="rgb(161 161 170 / 0.3)"
        />
        <Controls
          showInteractive={false}
          className="!rounded-lg !border-zinc-200 !bg-white !shadow-sm dark:!border-zinc-700 dark:!bg-zinc-900 [&>button]:!border-zinc-200 [&>button]:!bg-white dark:[&>button]:!border-zinc-700 dark:[&>button]:!bg-zinc-900 dark:[&>button]:!fill-zinc-400"
        />
        <MiniMap
          nodeStrokeWidth={3}
          className="!rounded-lg !border-zinc-200 !bg-white !shadow-sm dark:!border-zinc-700 dark:!bg-zinc-900"
          maskColor="rgb(0 0 0 / 0.08)"
        />
      </ReactFlow>
    </div>
  );
}
