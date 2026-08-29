import { create } from 'zustand';
import * as api from '@/lib/api';
import type { WorkflowRevisionComparison } from '@/types';
import { useRevisionHistoryStore } from './revisionHistoryStore';
import { useUIStore } from './uiStore';

interface RevisionComparisonState {
  comparison: WorkflowRevisionComparison | null;
  isLoading: boolean;
  error: string | null;
  requestToken: number;
  editableSelectedNodeId: string | null;
  selectedChangeKey: string | null;

  compare: (workflowId: string, fromRevision: number, toRevision: number) => Promise<void>;
  exitComparison: () => void;
  selectChange: (key: string | null) => void;
  reset: () => void;
}

const initialState = {
  comparison: null as WorkflowRevisionComparison | null,
  isLoading: false,
  error: null as string | null,
  requestToken: 0,
  editableSelectedNodeId: null as string | null,
  selectedChangeKey: null as string | null,
};

export const useRevisionComparisonStore = create<RevisionComparisonState>((set, get) => ({
  ...initialState,

  compare: async (workflowId, fromRevision, toRevision) => {
    if (useRevisionHistoryStore.getState().previewRevision) {
      useRevisionHistoryStore.getState().backToCurrent();
    }
    const requestToken = get().requestToken + 1;
    const editableSelectedNodeId = get().comparison
      ? get().editableSelectedNodeId
      : useUIStore.getState().selectedNodeId;
    set({
      requestToken,
      editableSelectedNodeId,
      isLoading: true,
      error: null,
      selectedChangeKey: null,
    });
    try {
      const comparison = await api.compareWorkflowRevisions(workflowId, fromRevision, toRevision);
      if (get().requestToken !== requestToken) return;
      set({ comparison });
      useUIStore.getState().selectNode(null);
      useUIStore.getState().restoreExecutionInspector();
    } catch (error) {
      if (get().requestToken !== requestToken) return;
      set({ error: api.getApiErrorMessage(error, 'These revisions could not be compared.') });
    } finally {
      if (get().requestToken === requestToken) set({ isLoading: false });
    }
  },

  exitComparison: () => {
    const selectedNodeId = get().comparison
      ? get().editableSelectedNodeId
      : useUIStore.getState().selectedNodeId;
    set((state) => ({
      ...initialState,
      requestToken: state.requestToken + 1,
    }));
    useUIStore.getState().selectNode(selectedNodeId);
  },

  selectChange: (selectedChangeKey) => set({ selectedChangeKey }),

  reset: () => set((state) => ({
    ...initialState,
    requestToken: state.requestToken + 1,
  })),
}));
