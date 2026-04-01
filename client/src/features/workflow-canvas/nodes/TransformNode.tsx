import { memo } from 'react';
import type { NodeProps, Node } from '@xyflow/react';
import type { FlowNodeData, TransformConfig } from '@/types';
import { BaseNode } from './BaseNode';

type TransformNodeProps = NodeProps<Node<FlowNodeData>>;

export const TransformNode = memo(function TransformNode({ data }: TransformNodeProps) {
  const config = data.config as TransformConfig;
  const subtitle = config.description || config.transformCode?.slice(0, 28) + '…';

  return (
    <BaseNode
      nodeType="transform"
      label={data.label}
      subtitle={subtitle}
    />
  );
});
