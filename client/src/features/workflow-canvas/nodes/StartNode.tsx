import { memo } from 'react';
import type { NodeProps, Node } from '@xyflow/react';
import type { FlowNodeData } from '@/types';
import { BaseNode } from './BaseNode';

type StartNodeProps = NodeProps<Node<FlowNodeData>>;

export const StartNode = memo(function StartNode({ data }: StartNodeProps) {
  return (
    <BaseNode
      nodeType="start"
      label={data.label}
      hideInput
    />
  );
});
