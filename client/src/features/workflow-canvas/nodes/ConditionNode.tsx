import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps, Node } from '@xyflow/react';
import type { FlowNodeData, ConditionConfig } from '@/types';
import { BaseNode } from './BaseNode';

type ConditionNodeProps = NodeProps<Node<FlowNodeData>>;

export const ConditionNode = memo(function ConditionNode({ data }: ConditionNodeProps) {
  const config = data.config as ConditionConfig;
  const subtitle = config.expression
    ? config.expression.slice(0, 30) + (config.expression.length > 30 ? '…' : '')
    : 'No expression';

  return (
    <BaseNode
      nodeType="condition"
      label={data.label}
      subtitle={subtitle}
    >
      {/* Input handle — left center */}
      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !rounded-full !border-2 !border-[var(--border-active)] !bg-[var(--surface-overlay)]"
      />

      {/* True output — right top */}
      <Handle
        type="source"
        position={Position.Right}
        id="condition_true"
        style={{ top: '35%' }}
        className="!h-3 !w-3 !rounded-full !border-2 !border-emerald-400 !bg-[var(--surface-overlay)]"
      />

      {/* False output — right bottom */}
      <Handle
        type="source"
        position={Position.Right}
        id="condition_false"
        style={{ top: '65%' }}
        className="!h-3 !w-3 !rounded-full !border-2 !border-rose-400 !bg-[var(--surface-overlay)]"
      />

      {/* Handle labels */}
      <span className="absolute -right-7 text-[7px] font-semibold uppercase tracking-wide text-emerald-300" style={{ top: '19%' }}>
        True
      </span>
      <span className="absolute -right-7 text-[7px] font-semibold uppercase tracking-wide text-rose-300" style={{ top: '70%' }}>
        False
      </span>
    </BaseNode>
  );
});
