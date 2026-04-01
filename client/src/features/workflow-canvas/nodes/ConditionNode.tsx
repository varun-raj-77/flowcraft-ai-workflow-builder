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
        className="!h-3 !w-3 !rounded-full !border-2 !border-zinc-300 !bg-white dark:!border-zinc-600 dark:!bg-zinc-800"
      />

      {/* True output — right top */}
      <Handle
        type="source"
        position={Position.Right}
        id="condition_true"
        style={{ top: '35%' }}
        className="!h-3 !w-3 !rounded-full !border-2 !border-emerald-400 !bg-white dark:!border-emerald-500 dark:!bg-zinc-800"
      />

      {/* False output — right bottom */}
      <Handle
        type="source"
        position={Position.Right}
        id="condition_false"
        style={{ top: '65%' }}
        className="!h-3 !w-3 !rounded-full !border-2 !border-rose-400 !bg-white dark:!border-rose-500 dark:!bg-zinc-800"
      />

      {/* Handle labels */}
      <span className="absolute -right-1 text-[8px] font-medium text-emerald-600 dark:text-emerald-400" style={{ top: '22%' }}>
        T
      </span>
      <span className="absolute -right-1 text-[8px] font-medium text-rose-600 dark:text-rose-400" style={{ top: '72%' }}>
        F
      </span>
    </BaseNode>
  );
});
