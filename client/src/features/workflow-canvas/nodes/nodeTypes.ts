import type { NodeTypes } from '@xyflow/react';
import { StartNode } from './StartNode';
import { ApiCallNode } from './ApiCallNode';
import { ConditionNode } from './ConditionNode';
import { TransformNode } from './TransformNode';
import { DelayNode } from './DelayNode';
import { OutputNode } from './OutputNode';
import { EndNode } from './EndNode';

/**
 * Maps NodeType string → React Flow custom component.
 *
 * MUST be defined at module scope (outside any component).
 * If defined inside a component, React Flow receives a new object reference
 * on every render and unmounts/remounts all nodes — destroying selection,
 * causing flicker, and killing performance.
 */
export const nodeTypes: NodeTypes = {
  start: StartNode,
  api_call: ApiCallNode,
  condition: ConditionNode,
  transform: TransformNode,
  delay: DelayNode,
  output: OutputNode,
  end: EndNode,
};
