import { useCallback, type DragEvent } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useWorkflowStore } from '@/stores/workflowStore';
import type { NodeType } from '@/types';

/**
 * Custom MIME type for drag transfer data.
 * Avoids conflicts with native browser drag behavior.
 */
export const DND_TRANSFER_TYPE = 'application/flowcraft-node-type';

/**
 * Returns onDragOver and onDrop handlers for the React Flow canvas.
 *
 * Flow:
 * 1. NodePalette sets dataTransfer with DND_TRANSFER_TYPE + nodeType on drag start
 * 2. Canvas onDragOver calls preventDefault to allow the drop
 * 3. Canvas onDrop reads the type, converts screen→flow coords, creates the node
 */
export function useDragAndDrop() {
  const { screenToFlowPosition } = useReactFlow();
  const addNode = useWorkflowStore((s) => s.addNode);

  const onDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();

      const nodeType = event.dataTransfer.getData(DND_TRANSFER_TYPE) as NodeType;
      if (!nodeType) return;

      // Convert the drop position from screen pixels to the React Flow
      // canvas coordinate system (accounts for pan + zoom)
      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      addNode(nodeType, position);
    },
    [screenToFlowPosition, addNode],
  );

  return { onDragOver, onDrop };
}
