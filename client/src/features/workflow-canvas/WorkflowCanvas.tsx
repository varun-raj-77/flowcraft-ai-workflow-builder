'use client';

import { useCallback, useEffect, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  type NodeMouseHandler,
  type IsValidConnection,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { useWorkflowStore } from '@/stores/workflowStore';
import { useUIStore } from '@/stores/uiStore';
import { useExecutionStore } from '@/stores/executionStore';
import { nodeTypes } from './nodes/nodeTypes';
import { useDragAndDrop } from './hooks/useDragAndDrop';
import { focusExecutionNode } from './executionNodeFocus';

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
  const { setCenter, getViewport } = useReactFlow();
  // ── Store bindings ────────────────────────────────────────
  const nodes = useWorkflowStore((s) => s.nodes);
  const edges = useWorkflowStore((s) => s.edges);
  const onNodesChange = useWorkflowStore((s) => s.onNodesChange);
  const onEdgesChange = useWorkflowStore((s) => s.onEdgesChange);
  const onConnect = useWorkflowStore((s) => s.onConnect);

  const selectNode = useUIStore((s) => s.selectNode);
  const undoToast = useUIStore((s) => s.undoToast);
  const showUndoToast = useUIStore((s) => s.showUndoToast);
  const clearUndoToast = useUIStore((s) => s.clearUndoToast);
  const selectedStepNodeId = useExecutionStore((s) => s.selectedStepNodeId);
  const isRunning = useExecutionStore((s) => s.isRunning);
  const lastFocusedExecutionNodeId = useRef<string | null>(null);

  useEffect(() => {
    lastFocusedExecutionNodeId.current = focusExecutionNode({
      selectedNodeId: selectedStepNodeId,
      lastFocusedNodeId: lastFocusedExecutionNodeId.current,
      nodes,
      getViewport,
      setCenter,
    });
  }, [selectedStepNodeId, nodes, setCenter, getViewport]);

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
      const target = event.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]')) return;
      if (event.key === 'Delete' || event.key === 'Backspace') {
        const selectedNodeId = useUIStore.getState().selectedNodeId;
        if (selectedNodeId) {
          const incoming = useWorkflowStore.getState().edges.filter((edge) => edge.target === selectedNodeId);
          const outgoing = useWorkflowStore.getState().edges.filter((edge) => edge.source === selectedNodeId);
          const node = useWorkflowStore.getState().nodes.find((item) => item.id === selectedNodeId);
          if (node?.data.nodeType === 'start' || node?.data.nodeType === 'end') {
            window.alert(`Delete ${node.data.label}? This may make the workflow non-runnable.`);
            return;
          }
          if (incoming.length === 1 && outgoing.length === 1) {
            const shouldReconnect = window.confirm(`Deleting ${node?.data.label ?? 'this node'} will break its path. Reconnect the surrounding nodes?`);
            if (!shouldReconnect) return;
            const [before] = incoming;
            const [after] = outgoing;
            if (before.source !== after.target && isValidConnection({ source: before.source, target: after.target, sourceHandle: before.sourceHandle, targetHandle: after.targetHandle })) {
              useWorkflowStore.getState().removeNodeAndReconnect(selectedNodeId, { source: before.source, target: after.target, sourceHandle: before.sourceHandle, targetHandle: after.targetHandle });
              showUndoToast('Node deleted — Undo');
              selectNode(null);
              return;
            }
          } else if (incoming.length + outgoing.length > 1 && !window.confirm(`Delete ${node?.data.label ?? 'this node'} and ${incoming.length + outgoing.length} affected connection(s)?`)) return;
          useWorkflowStore.getState().removeNode(selectedNodeId);
          showUndoToast('Node deleted — Undo');
          selectNode(null);
        } else {
          const selectedEdge = useWorkflowStore.getState().edges.find((edge) => edge.selected);
          if (selectedEdge) { useWorkflowStore.getState().removeEdge(selectedEdge.id); showUndoToast('Edge deleted — Undo'); }
        }
      }
    },
    [isValidConnection, selectNode, showUndoToast],
  );

  return (
    <div className="relative flex-1" onKeyDown={onKeyDown} tabIndex={0}>
      {undoToast && <div role="status" className="absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-zinc-900 px-3 py-2 text-xs text-white shadow-lg"><span>{undoToast}</span><button type="button" onClick={() => { useWorkflowStore.getState().undo(); clearUndoToast(); }} className="rounded px-1.5 py-0.5 font-semibold underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">Undo</button><button type="button" aria-label="Dismiss undo notification" onClick={clearUndoToast}>×</button></div>}
      {nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <div className="rounded-2xl border border-dashed border-zinc-300 bg-white/90 px-6 py-5 text-center shadow-sm backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/90">
            <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100 text-sm font-semibold text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">AI</span>
            <p className="mt-3 text-sm font-semibold text-zinc-800 dark:text-zinc-100">Start with a workflow node</p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Drag a node here or generate a workflow with AI.</p>
          </div>
        </div>
      )}
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
          animated: isRunning,
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
