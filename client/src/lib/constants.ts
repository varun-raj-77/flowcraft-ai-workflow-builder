import type { NodeType } from '@/types';

export interface NodeTypeInfo {
  type: NodeType;
  label: string;
  description: string;
  icon: string;     // emoji for now, swap for Lucide icons later
  color: string;    // Tailwind color class prefix (e.g. 'sky' → bg-sky-500)
}

export const NODE_TYPE_REGISTRY: Record<NodeType, NodeTypeInfo> = {
  start: {
    type: 'start',
    label: 'Start',
    description: 'Entry point of the workflow',
    icon: '▶',
    color: 'emerald',
  },
  api_call: {
    type: 'api_call',
    label: 'API Call',
    description: 'Make an HTTP request',
    icon: '⇄',
    color: 'sky',
  },
  condition: {
    type: 'condition',
    label: 'Condition',
    description: 'Branch based on a condition',
    icon: '◇',
    color: 'amber',
  },
  transform: {
    type: 'transform',
    label: 'Transform',
    description: 'Transform data with code',
    icon: '⚙',
    color: 'violet',
  },
  delay: {
    type: 'delay',
    label: 'Delay',
    description: 'Wait before continuing',
    icon: '⏱',
    color: 'teal',
  },
  output: {
    type: 'output',
    label: 'Output',
    description: 'Log or output data',
    icon: '▸',
    color: 'rose',
  },
  end: {
    type: 'end',
    label: 'End',
    description: 'Terminal point of the workflow',
    icon: '⏹',
    color: 'zinc',
  },
} as const;

/**
 * Node types available in the palette for users to drag onto the canvas.
 * Start and End are included — users place them explicitly.
 */
export const PALETTE_NODE_TYPES = Object.values(NODE_TYPE_REGISTRY);

export const APP_NAME = 'FlowCraft';
