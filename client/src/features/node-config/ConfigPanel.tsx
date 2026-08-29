'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useUIStore } from '@/stores/uiStore';
import { useWorkflowStore } from '@/stores/workflowStore';
import { useRevisionHistoryStore } from '@/stores/revisionHistoryStore';
import { NODE_TYPE_REGISTRY } from '@/lib/constants';
import type {
  NodeType,
  ApiCallConfig,
  ConditionConfig,
  TransformConfig,
  DelayConfig,
  OutputConfig,
} from '@/types';
import { TextInput } from './components/FormInputs';
import { ApiCallConfigForm } from './forms/ApiCallConfigForm';
import { ConditionConfigForm } from './forms/ConditionConfigForm';
import { TransformConfigForm } from './forms/TransformConfigForm';
import { DelayConfigForm } from './forms/DelayConfigForm';
import { OutputConfigForm } from './forms/OutputConfigForm';

// ── Label editor (shared across all node types) ─────────────

interface LabelEditorProps {
  nodeId: string;
  initialLabel: string;
}

function LabelEditor({ nodeId, initialLabel }: LabelEditorProps) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const [label, setLabel] = useState(initialLabel);

  // Sync when switching nodes
  useEffect(() => {
    setLabel(initialLabel);
  }, [nodeId, initialLabel]);

  const commitLabel = useCallback(() => {
    const trimmed = label.trim();
    if (trimmed && trimmed !== initialLabel) {
      updateNodeData(nodeId, { label: trimmed });
    } else if (!trimmed) {
      setLabel(initialLabel); // Revert empty input
    }
  }, [label, initialLabel, nodeId, updateNodeData]);

  return (
    <TextInput
      value={label}
      onChange={(e) => setLabel(e.target.value)}
      onBlur={commitLabel}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.currentTarget.blur();
        }
      }}
      className="font-medium"
      aria-label="Node label"
    />
  );
}

// ── Form switcher ───────────────────────────────────────────

interface ConfigFormSwitchProps {
  nodeId: string;
  nodeType: NodeType;
  config: Record<string, unknown>;
}

function ConfigFormSwitch({ nodeId, nodeType, config }: ConfigFormSwitchProps) {
  switch (nodeType) {
    case 'api_call':
      return <ApiCallConfigForm nodeId={nodeId} config={config as unknown as ApiCallConfig} />;
    case 'condition':
      return <ConditionConfigForm nodeId={nodeId} config={config as unknown as ConditionConfig} />;
    case 'transform':
      return <TransformConfigForm nodeId={nodeId} config={config as unknown as TransformConfig} />;
    case 'delay':
      return <DelayConfigForm nodeId={nodeId} config={config as unknown as DelayConfig} />;
    case 'output':
      return <OutputConfigForm nodeId={nodeId} config={config as unknown as OutputConfig} />;
    case 'start':
    case 'end':
      return (
        <div className="rounded-md border border-[var(--border-faint)] bg-[var(--surface-base)] px-3 py-4 text-center">
          <p className="text-xs text-[var(--text-muted)]">
            {nodeType === 'start' ? 'Start' : 'End'} nodes have no configuration.
          </p>
        </div>
      );
    default:
      return null;
  }
}

// ── Main panel ──────────────────────────────────────────────

export function ConfigPanel() {
  const selectedNodeId = useUIStore((s) => s.selectedNodeId);
  const isOpen = useUIStore((s) => s.isConfigPanelOpen);
  const selectNode = useUIStore((s) => s.selectNode);
  const nodes = useWorkflowStore((s) => s.nodes);
  const removeNode = useWorkflowStore((s) => s.removeNode);
  const edges = useWorkflowStore((s) => s.edges);
  const previewRevision = useRevisionHistoryStore((s) => s.previewRevision);

  if (!isOpen || !selectedNodeId) return null;

  if (previewRevision) {
    const historicalNode = previewRevision.nodes.find((item) => item.id === selectedNodeId);
    if (!historicalNode) return null;
    const historicalTypeInfo = NODE_TYPE_REGISTRY[historicalNode.type];
    return (
      <aside
        aria-label={`Read-only details for ${historicalNode.label}`}
        className="flex w-72 flex-col border-l border-[var(--border-subtle)] bg-[var(--surface-shell)] text-[var(--text-primary)]"
      >
        <div className="border-b border-[var(--border-subtle)] px-4 py-4">
          <p className="fc-kicker mb-3 text-violet-400">Historical node</p>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm">{historicalTypeInfo.icon}</span>
              <span className="rounded bg-[var(--surface-hover)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-muted)]">
                {historicalTypeInfo.label}
              </span>
            </div>
            <button
              type="button"
              onClick={() => selectNode(null)}
              className="fc-focus rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
              aria-label="Close panel"
            >
              ✕
            </button>
          </div>
          <p className="mt-3 text-sm font-medium">{historicalNode.label}</p>
          {historicalNode.description && (
            <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">{historicalNode.description}</p>
          )}
          <p className="mt-2 truncate font-mono text-[9px] text-[var(--text-disabled)]" title={historicalNode.id}>{historicalNode.id}</p>
          <span className="mt-3 inline-flex rounded-full bg-violet-950 px-2 py-0.5 text-[10px] font-medium text-violet-300">
            Read only · v{previewRevision.revision}
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <h3 className="fc-kicker text-[var(--text-muted)]">Configuration</h3>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-base)] p-3 font-mono text-[11px] leading-5 text-[var(--text-secondary)]">
            {JSON.stringify(historicalNode.config, null, 2)}
          </pre>
        </div>
      </aside>
    );
  }

  const node = nodes.find((n) => n.id === selectedNodeId);
  if (!node) return null;

  const typeInfo = NODE_TYPE_REGISTRY[node.data.nodeType];

  return (
    <aside aria-label="Node configuration" className="flex w-72 flex-col border-l border-[var(--border-subtle)] bg-[var(--surface-shell)]">
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="border-b border-[var(--border-subtle)] px-4 py-4">
        <p className="fc-kicker mb-3 text-violet-400">Node configuration</p>
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm">{typeInfo.icon}</span>
            <span className="rounded bg-[var(--surface-hover)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-muted)]">
              {typeInfo.label}
            </span>
          </div>
          <button
            onClick={() => selectNode(null)}
            className="fc-focus rounded-md p-1 text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
            aria-label="Close panel"
          >
            ✕
          </button>
        </div>

        {/* Editable label */}
        <LabelEditor nodeId={node.id} initialLabel={node.data.label} />

        {/* Node ID (read-only, for debugging) */}
        <p className="mt-2 truncate font-mono text-[9px] text-[var(--text-disabled)]" title={node.id}>
          {node.id}
        </p>
        <button
          type="button"
          onClick={() => {
            const affected = edges.filter((edge) => edge.source === node.id || edge.target === node.id).length;
            if ((node.data.nodeType === 'start' || node.data.nodeType === 'end' || affected > 1) && !window.confirm(`Delete ${node.data.label} and ${affected} affected connection(s)?`)) return;
            removeNode(node.id);
            selectNode(null);
          }}
          className="fc-focus mt-3 rounded-md px-2 py-1 text-[10px] font-medium text-red-300 hover:bg-red-500/10"
        >
          Delete node
        </button>
      </div>

      {/* ── Form body ──────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <ConfigFormSwitch
          nodeId={node.id}
          nodeType={node.data.nodeType}
          config={node.data.config as Record<string, unknown>}
        />
      </div>
    </aside>
  );
}
