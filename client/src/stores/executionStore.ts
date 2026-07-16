import { create } from 'zustand';
import type { ExecutionRun, StepLog, ExecutionStatus } from '@/types';

interface ExecutionState {
  // State
  currentRun: ExecutionRun | null;
  isRunning: boolean;
  lastError: string | null;

  // Actions
  setCurrentRun: (run: ExecutionRun) => void;
  updateNodeStatus: (nodeId: string, update: Partial<StepLog>) => void;
  setRunStatus: (status: ExecutionStatus) => void;
  clearExecution: () => void;
  setLastError: (error: string | null) => void;
}

export const useExecutionStore = create<ExecutionState>((set) => ({
  currentRun: null,
  isRunning: false,
  lastError: null,

  setCurrentRun: (run) =>
    set({
      currentRun: run,
      isRunning: run.status === 'running',
      lastError: null,
    }),

  updateNodeStatus: (nodeId, update) =>
    set((state) => {
      if (!state.currentRun) return state;
      return {
        currentRun: {
          ...state.currentRun,
          stepLogs: state.currentRun.stepLogs.map((log) =>
            log.nodeId === nodeId ? { ...log, ...update } : log
          ),
        },
      };
    }),

  setRunStatus: (status) =>
    set((state) => ({
      currentRun: state.currentRun
        ? { ...state.currentRun, status }
        : null,
      isRunning: status === 'running',
    })),

  clearExecution: () =>
    set({ currentRun: null, isRunning: false, lastError: null }),

  setLastError: (lastError) => set({ lastError }),
}));
