'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
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

import { toFlowEdge, toFlowNode, useWorkflowStore } from '@/stores/workflowStore';
import { useRevisionHistoryStore } from '@/stores/revisionHistoryStore';
import { useRevisionComparisonStore } from '@/stores/revisionComparisonStore';
import { useUIStore } from '@/stores/uiStore';
import { useExecutionStore } from '@/stores/executionStore';
import { nodeTypes } from './nodes/nodeTypes';
import { useDragAndDrop } from './hooks/useDragAndDrop';
import { focusExecutionNode } from './executionNodeFocus';
import { buildComparisonGraph } from '@/features/revision-comparison/comparisonGraph';

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
  const editableNodes = useWorkflowStore((s) => s.nodes);
  const editableEdges = useWorkflowStore((s) => s.edges);
  const onNodesChange = useWorkflowStore((s) => s.onNodesChange);
  const onEdgesChange = useWorkflowStore((s) => s.onEdgesChange);
  const onConnect = useWorkflowStore((s) => s.onConnect);
  const previewRevision = useRevisionHistoryStore((s) => s.previewRevision);
  const previewNodes = useMemo(
    () => previewRevision?.nodes.map(toFlowNode) ?? [],
    [previewRevision],
  );
  const previewEdges = useMemo(
    () => previewRevision?.edges.map(toFlowEdge) ?? [],
    [previewRevision],
  );
  const comparison = useRevisionComparisonStore((s) => s.comparison);
  const comparisonGraph = useMemo(
    () => comparison ? buildComparisonGraph(comparison) : { nodes: [], edges: [] },
    [comparison],
  );
  const isHistorical = previewRevision !== null;
  const isComparing = comparison !== null;
  const isReadOnly = isHistorical || isComparing;
  const nodes = isComparing ? comparisonGraph.nodes : isHistorical ? previewNodes : editableNodes;
  const edges = isComparing ? comparisonGraph.edges : isHistorical ? previewEdges : editableEdges;

  const selectNode = useUIStore((s) => s.selectNode);
  const undoToast = useUIStore((s) => s.undoToast);
  const showUndoToast = useUIStore((s) => s.showUndoToast);
  const clearUndoToast = useUIStore((s) => s.clearUndoToast);
  const selectedStepNodeId = useExecutionStore((s) => s.selectedStepNodeId);
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
      if (isReadOnly) return;
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
            if (before.source !== after.target && isValidConnection({ source: before.source, target: after.target, sourceHandle: before.sourceHandle ?? null, targetHandle: after.targetHandle ?? null })) {
              useWorkflowStore.getState().removeNodeAndReconnect(selectedNodeId, { source: before.source, target: after.target, sourceHandle: before.sourceHandle ?? null, targetHandle: after.targetHandle ?? null });
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
    [isReadOnly, isValidConnection, selectNode, showUndoToast],
  );

  return (
    <div className="relative flex-1 bg-[var(--surface-canvas)]" onKeyDown={onKeyDown} tabIndex={0} aria-label="Workflow canvas">
      {!isReadOnly && undoToast && <div role="status" className="absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-zinc-900 px-3 py-2 text-xs text-white shadow-lg"><span>{undoToast}</span><button type="button" onClick={() => { useWorkflowStore.getState().undo(); clearUndoToast(); }} className="rounded px-1.5 py-0.5 font-semibold underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">Undo</button><button type="button" aria-label="Dismiss undo notification" onClick={clearUndoToast}>×</button></div>}
      {nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <div className="fc-empty-state px-6 py-5 text-center shadow-xl backdrop-blur">
            <span className="mx-auto flex h-9 w-9 items-center justify-center rounded-lg border border-violet-500/25 bg-violet-500/10 text-xs font-semibold text-violet-300">AI</span>
            <p className="mt-3 text-sm font-semibold text-[var(--text-primary)]">{isReadOnly ? 'This revision has no nodes' : 'Start with a workflow node'}</p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">{isReadOnly ? 'Return to the current revision to edit the workflow.' : 'Drag a node here or generate a workflow with AI.'}</p>
          </div>
        </div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={isReadOnly ? undefined : onNodesChange}
        onEdgesChange={isReadOnly ? undefined : onEdgesChange}
        onConnect={isReadOnly ? undefined : onConnect}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onDragOver={isReadOnly ? undefined : onDragOver}
        onDrop={isReadOnly ? undefined : onDrop}
        isValidConnection={isValidConnection}
        nodesDraggable={!isReadOnly}
        nodesConnectable={!isReadOnly}
        deleteKeyCode={isReadOnly ? null : ['Backspace', 'Delete']}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        defaultEdgeOptions={{
          type: 'smoothstep',
          animated: false,
        }}
        proOptions={{ hideAttribution: true }}
        className="bg-[var(--surface-canvas)]"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="rgb(113 113 122 / 0.24)"
        />
        <Controls
          showInteractive={false}
          className="!overflow-hidden !rounded-lg !border-[var(--border-subtle)] !bg-[var(--surface-raised)] !shadow-xl [&>button]:!border-[var(--border-faint)] [&>button]:!bg-[var(--surface-raised)] [&>button]:!fill-[var(--text-muted)] hover:[&>button]:!bg-[var(--surface-hover)]"
        />
        <MiniMap
          nodeStrokeWidth={3}
          nodeColor="var(--border-default)"
          nodeStrokeColor="var(--text-muted)"
          className="!rounded-lg !border-[var(--border-subtle)] !bg-[var(--surface-raised)] !shadow-xl"
          maskColor="rgb(8 8 11 / 0.72)"
        />
      </ReactFlow>
    </div>
  );
}
