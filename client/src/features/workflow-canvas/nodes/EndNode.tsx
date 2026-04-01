import { memo } from 'react';
import type { NodeProps, Node } from '@xyflow/react';
import type { FlowNodeData } from '@/types';
import { BaseNode } from './BaseNode';

type EndNodeProps = NodeProps<Node<FlowNodeData>>;

export const EndNode = memo(function EndNode({ data }: EndNodeProps) {
  return (
    <BaseNode
      nodeType="end"
      label={data.label}
      hideOutput
    />
  );
});
