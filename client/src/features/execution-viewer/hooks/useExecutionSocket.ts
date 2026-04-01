import { useEffect, useCallback, useRef } from 'react';
import { getSocket } from '@/lib/socket';
import { useExecutionStore } from '@/stores/executionStore';
import * as api from '@/lib/api';
import type { StepStatus, ExecutionStatus } from '@/types';

interface NodeStatusEvent {
  runId: string;
  nodeId: string;
  status: StepStatus;
  output?: Record<string, unknown>;
  durationMs?: number;
  error?: string;
}

interface ExecutionCompleteEvent {
  runId: string;
  status: ExecutionStatus;
  error?: string;
}

/**
 * Manages the Socket.IO lifecycle for a specific execution run.
 *
 * Flow:
 * 1. Call `joinRun(runId)` after the POST /run endpoint returns
 * 2. Hook joins the socket room, listens for events
 * 3. Each node:status event updates the executionStore
 * 4. execution:complete fetches the final run from the API (catches any missed events)
 * 5. On unmount or new run, cleans up listeners and leaves the room
 */
export function useExecutionSocket() {
  const updateNodeStatus = useExecutionStore((s) => s.updateNodeStatus);
  const setRunStatus = useExecutionStore((s) => s.setRunStatus);
  const setCurrentRun = useExecutionStore((s) => s.setCurrentRun);
  const currentRunId = useRef<string | null>(null);

  // Clean up previous room
  const leaveCurrentRoom = useCallback(() => {
    if (currentRunId.current) {
      const socket = getSocket();
      socket.emit('leave:execution', currentRunId.current);
      socket.off('node:status');
      socket.off('execution:complete');
      currentRunId.current = null;
    }
  }, []);

  // Join a new run room and start listening
  const joinRun = useCallback(
    (runId: string) => {
      leaveCurrentRoom();

      const socket = getSocket();
      currentRunId.current = runId;

      socket.emit('join:execution', runId);

      socket.on('node:status', (event: NodeStatusEvent) => {
        if (event.runId !== runId) return;
        updateNodeStatus(event.nodeId, {
          status: event.status,
          output: event.output,
          durationMs: event.durationMs,
          error: event.error,
        });
      });

      socket.on('execution:complete', async (event: ExecutionCompleteEvent) => {
        if (event.runId !== runId) return;

        // Fetch the final run to catch any events we might have missed
        // (e.g. if the socket connected slightly late)
        try {
          const finalRun = await api.getExecution(runId);
          setCurrentRun(finalRun);
        } catch {
          // Fallback: just update the status
          setRunStatus(event.status);
        }
      });
    },
    [leaveCurrentRoom, updateNodeStatus, setRunStatus, setCurrentRun],
  );

  // Clean up on unmount
  useEffect(() => {
    return () => {
      leaveCurrentRoom();
    };
  }, [leaveCurrentRoom]);

  return { joinRun, leaveCurrentRoom };
}
