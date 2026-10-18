import { create } from 'zustand';
import type { ExecutionRun, StepLog, ExecutionStatus } from '@/types';
import type { InspectorTab } from '@/features/execution-viewer/executionInspector';

/** Prevent unbounded in-memory payload accumulation while browsing historical runs. */
export const MAX_LOADED_HISTORY_RUNS = 200;

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
  historyNextCursor: string | null;
  historyMoreStatus: 'idle' | 'loading' | 'error';
  historyMoreError: string | null;
  historyCapReached: boolean;
  selectedStepNodeId: string | null;
  activeInspectorTab: InspectorTab;
  replayRunId: string | null;
  replayStepIndex: number | null;

  // Actions
  setCurrentRun: (run: ExecutionRun) => void;
  updateNodeStatus: (nodeId: string, update: Partial<StepLog>) => void;
  setRunStatus: (status: ExecutionStatus) => void;
  clearExecution: () => void;
  setLastError: (error: string | null) => void;
  setHistoryLoading: (workflowId: string) => void;
  setHistory: (workflowId: string, runs: ExecutionRun[], nextCursor?: string | null) => void;
  setHistoryMoreLoading: (workflowId: string, cursor: string) => void;
  appendHistoryPage: (workflowId: string, cursor: string, runs: ExecutionRun[], nextCursor: string | null) => void;
  setHistoryMoreError: (workflowId: string, cursor: string, error: string) => void;
  setHistoryError: (workflowId: string, error: string) => void;
  clearHistory: () => void;
  selectHistoricalRun: (runId: string | null) => void;
  setSelectedStepNodeId: (nodeId: string | null) => void;
  setActiveInspectorTab: (tab: InspectorTab) => void;
  setReplayStep: (runId: string, stepIndex: number) => void;
  clearReplay: () => void;
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
  historyNextCursor: null,
  historyMoreStatus: 'idle',
  historyMoreError: null,
  historyCapReached: false,
  selectedStepNodeId: null,
  activeInspectorTab: 'live',
  replayRunId: null,
  replayStepIndex: null,

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
    set({ currentRun: null, isRunning: false, lastError: null, selectedStepNodeId: null, replayRunId: null, replayStepIndex: null }),

  setLastError: (lastError) => set({ lastError }),

  setHistoryLoading: (historyWorkflowId) =>
    set((state) => ({
      historyWorkflowId,
      historyRuns: state.historyWorkflowId === historyWorkflowId ? state.historyRuns : [],
      selectedHistoricalRunId: state.historyWorkflowId === historyWorkflowId ? state.selectedHistoricalRunId : null,
      historyStatus: 'loading',
      historyError: null,
      historyMoreStatus: 'idle',
      historyMoreError: null,
    })),

  setHistory: (historyWorkflowId, incomingRuns, nextCursor = null) =>
    set((state) => {
      const historyRuns = incomingRuns.slice(0, MAX_LOADED_HISTORY_RUNS);
      return {
        historyWorkflowId,
        historyRuns,
        historyNextCursor: historyRuns.length >= MAX_LOADED_HISTORY_RUNS ? null : nextCursor,
        historyCapReached: historyRuns.length >= MAX_LOADED_HISTORY_RUNS && nextCursor !== null,
        historyStatus: 'idle',
        historyError: null,
        historyMoreStatus: 'idle',
        historyMoreError: null,
        selectedHistoricalRunId: state.selectedHistoricalRunId && historyRuns.some((run) => run._id === state.selectedHistoricalRunId)
          ? state.selectedHistoricalRunId : null,
      };
    }),

  setHistoryMoreLoading: (workflowId, cursor) => set((state) => {
    if (state.historyWorkflowId !== workflowId || state.historyNextCursor !== cursor
      || state.historyStatus !== 'idle' || state.historyMoreStatus === 'loading') return state;
    return { historyMoreStatus: 'loading', historyMoreError: null };
  }),

  appendHistoryPage: (workflowId, cursor, runs, nextCursor) => set((state) => {
    if (state.historyWorkflowId !== workflowId || state.historyNextCursor !== cursor
      || state.historyMoreStatus !== 'loading') return state;
    // An overlapping boundary row must not duplicate the run or reset selection.
    const seen = new Set(state.historyRuns.map((run) => run._id));
    const additions = runs.filter((run) => {
      if (seen.has(run._id)) return false;
      seen.add(run._id); return true;
    });
    const historyRuns = [...state.historyRuns, ...additions].slice(0, MAX_LOADED_HISTORY_RUNS);
    const historyCapReached = historyRuns.length >= MAX_LOADED_HISTORY_RUNS && nextCursor !== null;
    return {
      historyRuns,
      historyNextCursor: historyCapReached ? null : nextCursor,
      historyCapReached,
      historyMoreStatus: 'idle',
      historyMoreError: null,
    };
  }),

  setHistoryMoreError: (workflowId, cursor, error) => set((state) =>
    state.historyWorkflowId !== workflowId || state.historyNextCursor !== cursor
      || state.historyMoreStatus !== 'loading'
      ? state : { historyMoreStatus: 'error', historyMoreError: error },
  ),

  setHistoryError: (historyWorkflowId, historyError) => set({ historyWorkflowId, historyStatus: 'error', historyError }),

  clearHistory: () => set({
    historyRuns: [],
    historyWorkflowId: null,
    selectedHistoricalRunId: null,
    historyStatus: 'idle',
    historyError: null,
    historyNextCursor: null,
    historyMoreStatus: 'idle',
    historyMoreError: null,
    historyCapReached: false,
    selectedStepNodeId: null,
    replayRunId: null,
    replayStepIndex: null,
  }),

  selectHistoricalRun: (selectedHistoricalRunId) => set({ selectedHistoricalRunId, selectedStepNodeId: null, replayRunId: null, replayStepIndex: null }),

  setSelectedStepNodeId: (selectedStepNodeId) => set({ selectedStepNodeId }),

  setActiveInspectorTab: (activeInspectorTab) => set({ activeInspectorTab }),
  setReplayStep: (replayRunId, replayStepIndex) => set({ replayRunId, replayStepIndex }),
  clearReplay: () => set({ replayRunId: null, replayStepIndex: null }),
}));
