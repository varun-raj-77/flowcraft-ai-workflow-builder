'use client';

import { useState, useEffect, useCallback } from 'react';
import { useUIStore } from '@/stores/uiStore';
import { useWorkflowStore } from '@/stores/workflowStore';
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
      return <ApiCallConfigForm nodeId={nodeId} config={config as ApiCallConfig} />;
    case 'condition':
      return <ConditionConfigForm nodeId={nodeId} config={config as ConditionConfig} />;
    case 'transform':
      return <TransformConfigForm nodeId={nodeId} config={config as TransformConfig} />;
    case 'delay':
      return <DelayConfigForm nodeId={nodeId} config={config as DelayConfig} />;
    case 'output':
      return <OutputConfigForm nodeId={nodeId} config={config as OutputConfig} />;
    case 'start':
    case 'end':
      return (
        <div className="rounded-md bg-zinc-50 px-3 py-4 text-center dark:bg-zinc-800/50">
          <p className="text-xs text-zinc-400 dark:text-zinc-500">
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

  if (!isOpen || !selectedNodeId) return null;

  const node = nodes.find((n) => n.id === selectedNodeId);
  if (!node) return null;

  const typeInfo = NODE_TYPE_REGISTRY[node.data.nodeType];

  return (
    <aside className="flex w-72 flex-col border-l border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm">{typeInfo.icon}</span>
            <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
              {typeInfo.label}
            </span>
          </div>
          <button
            onClick={() => selectNode(null)}
            className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
            aria-label="Close panel"
          >
            ✕
          </button>
        </div>

        {/* Editable label */}
        <LabelEditor nodeId={node.id} initialLabel={node.data.label} />

        {/* Node ID (read-only, for debugging) */}
        <p className="mt-2 font-mono text-[10px] text-zinc-400 dark:text-zinc-500">
          {node.id}
        </p>
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
