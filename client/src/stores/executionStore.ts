import { create } from 'zustand';
import type { ExecutionRun, StepLog, ExecutionStatus } from '@/types';
import type { InspectorTab } from '@/features/execution-viewer/executionInspector';

interface ExecutionState {
  // State
  currentRun: ExecutionRun | null;
  isRunning: boolean;
  lastError: string | null;
  historyRuns: ExecutionRun[];
  historyWorkflowId: string | null;
  selectedHistoricalRunId: string | null;
  historyStatus: 'idle' | 'loading' | 'error';
  historyError: string | null;
  selectedStepNodeId: string | null;
  activeInspectorTab: InspectorTab;

  // Actions
  setCurrentRun: (run: ExecutionRun) => void;
  updateNodeStatus: (nodeId: string, update: Partial<StepLog>) => void;
  setRunStatus: (status: ExecutionStatus) => void;
  clearExecution: () => void;
  setLastError: (error: string | null) => void;
  setHistoryLoading: (workflowId: string) => void;
  setHistory: (workflowId: string, runs: ExecutionRun[]) => void;
  setHistoryError: (workflowId: string, error: string) => void;
  clearHistory: () => void;
  selectHistoricalRun: (runId: string | null) => void;
  setSelectedStepNodeId: (nodeId: string | null) => void;
  setActiveInspectorTab: (tab: InspectorTab) => void;
}

export const useExecutionStore = create<ExecutionState>((set) => ({
  currentRun: null,
  isRunning: false,
  lastError: null,
  historyRuns: [],
  historyWorkflowId: null,
  selectedHistoricalRunId: null,
  historyStatus: 'idle',
  historyError: null,
  selectedStepNodeId: null,
  activeInspectorTab: 'live',

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
    set({ currentRun: null, isRunning: false, lastError: null, selectedStepNodeId: null }),

  setLastError: (lastError) => set({ lastError }),

  setHistoryLoading: (historyWorkflowId) =>
    set((state) => ({
      historyWorkflowId,
      historyRuns: state.historyWorkflowId === historyWorkflowId ? state.historyRuns : [],
      selectedHistoricalRunId: state.historyWorkflowId === historyWorkflowId ? state.selectedHistoricalRunId : null,
      historyStatus: 'loading',
      historyError: null,
    })),

  setHistory: (historyWorkflowId, historyRuns) =>
    set((state) => ({
      historyWorkflowId,
      historyRuns,
      historyStatus: 'idle',
      historyError: null,
      selectedHistoricalRunId: state.selectedHistoricalRunId && historyRuns.some((run) => run._id === state.selectedHistoricalRunId)
        ? state.selectedHistoricalRunId
        : null,
    })),

  setHistoryError: (historyWorkflowId, historyError) => set({ historyWorkflowId, historyStatus: 'error', historyError }),

  clearHistory: () => set({
    historyRuns: [],
    historyWorkflowId: null,
    selectedHistoricalRunId: null,
    historyStatus: 'idle',
    historyError: null,
    selectedStepNodeId: null,
  }),

  selectHistoricalRun: (selectedHistoricalRunId) => set({ selectedHistoricalRunId, selectedStepNodeId: null }),

  setSelectedStepNodeId: (selectedStepNodeId) => set({ selectedStepNodeId }),

  setActiveInspectorTab: (activeInspectorTab) => set({ activeInspectorTab }),
}));
