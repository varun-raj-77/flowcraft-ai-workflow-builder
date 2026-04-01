import { memo } from 'react';
import type { NodeProps, Node } from '@xyflow/react';
import type { FlowNodeData, DelayConfig } from '@/types';
import { BaseNode } from './BaseNode';

type DelayNodeProps = NodeProps<Node<FlowNodeData>>;

export const DelayNode = memo(function DelayNode({ data }: DelayNodeProps) {
  const config = data.config as DelayConfig;

  const ms = config.delayMs ?? 0;
  const subtitle = ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;

  return (
    <BaseNode
      nodeType="delay"
      label={data.label}
      subtitle={`Wait ${subtitle}`}
    />
  );
});
