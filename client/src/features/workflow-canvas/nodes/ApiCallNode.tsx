import { memo } from 'react';
import type { NodeProps, Node } from '@xyflow/react';
import type { FlowNodeData, ApiCallConfig } from '@/types';
import { BaseNode } from './BaseNode';

type ApiCallNodeProps = NodeProps<Node<FlowNodeData>>;

export const ApiCallNode = memo(function ApiCallNode({ data }: ApiCallNodeProps) {
  const config = data.config as unknown as ApiCallConfig;

  // Show method + truncated URL for quick visual identification
  const subtitle = config.url
    ? `${config.method} ${config.url.replace(/^https?:\/\//, '').slice(0, 24)}…`
    : config.method;

  return (
    <BaseNode
      nodeType="api_call"
      label={data.label}
      subtitle={subtitle}
    />
  );
});
