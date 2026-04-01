import { memo } from 'react';
import type { NodeProps, Node } from '@xyflow/react';
import type { FlowNodeData, OutputConfig } from '@/types';
import { BaseNode } from './BaseNode';

type OutputNodeProps = NodeProps<Node<FlowNodeData>>;

export const OutputNode = memo(function OutputNode({ data }: OutputNodeProps) {
  const config = data.config as OutputConfig;
  const subtitle = config.message
    ? `[${config.logLevel}] ${config.message.slice(0, 22)}…`
    : `[${config.logLevel}]`;

  return (
    <BaseNode
      nodeType="output"
      label={data.label}
      subtitle={subtitle}
    />
  );
});
