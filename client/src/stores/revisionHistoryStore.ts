import { create } from 'zustand';
import * as api from '@/lib/api';
import type { Workflow, WorkflowRevisionDetail, WorkflowRevisionSummary } from '@/types';
import { useWorkflowStore } from './workflowStore';
import { useUIStore } from './uiStore';

const HISTORY_PAGE_SIZE = 20;

interface RevisionHistoryState {
  workflowId: string | null;
  isPanelOpen: boolean;
  revisions: WorkflowRevisionSummary[];
  nextBeforeRevision: number | null;
  isLoading: boolean;
  isLoadingMore: boolean;
  historyError: string | null;
  previewRevision: WorkflowRevisionDetail | null;
  isPreviewLoading: boolean;
  previewError: string | null;
  isRestoreDialogOpen: boolean;
  isRestoring: boolean;
  restoreError: string | null;
  historyRequestToken: number;
  previewRequestToken: number;
  editableSelectedNodeId: string | null;

  openHistory: (workflowId: string) => Promise<void>;
  closeHistory: () => void;
  loadMore: () => Promise<void>;
  preview: (workflowId: string, revision: number) => Promise<void>;
  backToCurrent: () => void;
  openRestoreDialog: () => void;
  closeRestoreDialog: () => void;
  restorePreview: (workflowId: string, expectedRevision: number) => Promise<Workflow>;
  refreshHistory: (workflowId: string) => Promise<void>;
  reset: () => void;
}

const initialState = {
  workflowId: null,
  isPanelOpen: false,
  revisions: [] as WorkflowRevisionSummary[],
  nextBeforeRevision: null as number | null,
  isLoading: false,
  isLoadingMore: false,
  historyError: null as string | null,
  previewRevision: null as WorkflowRevisionDetail | null,
  isPreviewLoading: false,
  previewError: null as string | null,
  isRestoreDialogOpen: false,
  isRestoring: false,
  restoreError: null as string | null,
  historyRequestToken: 0,
  previewRequestToken: 0,
  editableSelectedNodeId: null as string | null,
};

function historyErrorMessage(error: unknown): string {
  return api.getApiErrorMessage(error, 'Revision history could not be loaded.');
}

function restoreErrorMessage(error: unknown): string {
  if (error instanceof api.ApiError && error.code === 'WORKFLOW_REVISION_CONFLICT') {
    return 'This workflow changed while you were viewing history. Return to the latest revision before restoring.';
  }
  if (error instanceof api.ApiError && error.code === 'WORKFLOW_REVISION_INTEGRITY_ERROR') {
    return 'This historical revision failed its integrity check and cannot be restored.';
  }
  return api.getApiErrorMessage(error, 'This revision could not be restored.');
}

export const useRevisionHistoryStore = create<RevisionHistoryState>((set, get) => ({
  ...initialState,

  openHistory: async (workflowId) => {
    set({ isPanelOpen: true });
    await get().refreshHistory(workflowId);
  },

  closeHistory: () => set({ isPanelOpen: false }),

  refreshHistory: async (workflowId) => {
    const requestToken = get().historyRequestToken + 1;
    set({
      workflowId,
      historyRequestToken: requestToken,
      isLoading: true,
      historyError: null,
      revisions: [],
      nextBeforeRevision: null,
    });
    try {
      const page = await api.listWorkflowRevisions(workflowId, { limit: HISTORY_PAGE_SIZE });
      if (get().workflowId !== workflowId || get().historyRequestToken !== requestToken) return;
      set({ revisions: page.revisions, nextBeforeRevision: page.nextBeforeRevision });
    } catch (error) {
      if (get().workflowId !== workflowId || get().historyRequestToken !== requestToken) return;
      set({ historyError: historyErrorMessage(error) });
    } finally {
      if (get().workflowId === workflowId && get().historyRequestToken === requestToken) set({ isLoading: false });
    }
  },

  loadMore: async () => {
    const { workflowId, nextBeforeRevision, isLoadingMore, historyRequestToken } = get();
    if (!workflowId || nextBeforeRevision === null || isLoadingMore) return;
    set({ isLoadingMore: true, historyError: null });
    try {
      const page = await api.listWorkflowRevisions(workflowId, {
        limit: HISTORY_PAGE_SIZE,
        beforeRevision: nextBeforeRevision,
      });
      if (get().workflowId !== workflowId || get().historyRequestToken !== historyRequestToken) return;
      set((state) => ({
        revisions: [...state.revisions, ...page.revisions],
        nextBeforeRevision: page.nextBeforeRevision,
      }));
    } catch (error) {
      if (get().workflowId === workflowId && get().historyRequestToken === historyRequestToken) {
        set({ historyError: historyErrorMessage(error) });
      }
    } finally {
      if (get().workflowId === workflowId && get().historyRequestToken === historyRequestToken) {
        set({ isLoadingMore: false });
      }
    }
  },

  preview: async (workflowId, revision) => {
    const requestToken = get().previewRequestToken + 1;
    const editableSelectedNodeId = get().previewRevision
      ? get().editableSelectedNodeId
      : useUIStore.getState().selectedNodeId;
    set({
      previewRequestToken: requestToken,
      editableSelectedNodeId,
      isPreviewLoading: true,
      previewError: null,
      restoreError: null,
    });
    try {
      const detail = await api.getWorkflowRevision(workflowId, revision);
      if (get().previewRequestToken !== requestToken) return;
      set({ previewRevision: detail, isPanelOpen: false });
      useUIStore.getState().selectNode(null);
      useUIStore.getState().restoreExecutionInspector();
    } catch (error) {
      if (get().previewRequestToken !== requestToken) return;
      set({ previewError: api.getApiErrorMessage(error, 'This revision could not be loaded.') });
    } finally {
      if (get().previewRequestToken === requestToken) set({ isPreviewLoading: false });
    }
  },

  backToCurrent: () => {
    const state = get();
    const selectedNodeId = state.previewRevision
      ? state.editableSelectedNodeId
      : useUIStore.getState().selectedNodeId;
    set((state) => ({
      previewRevision: null,
      previewError: null,
      restoreError: null,
      isRestoreDialogOpen: false,
      editableSelectedNodeId: null,
      previewRequestToken: state.previewRequestToken + 1,
    }));
    useUIStore.getState().selectNode(selectedNodeId);
  },

  openRestoreDialog: () => set({ isRestoreDialogOpen: true, restoreError: null }),
  closeRestoreDialog: () => set({ isRestoreDialogOpen: false, restoreError: null }),

  restorePreview: async (workflowId, expectedRevision) => {
    if (get().isRestoring) {
      throw new api.ApiError(409, 'RESTORE_IN_PROGRESS', 'A restore is already in progress.');
    }
    const target = get().previewRevision;
    if (!target) {
      throw new api.ApiError(400, 'RESTORE_TARGET_REQUIRED', 'Select a historical revision to restore.');
    }
    if (useWorkflowStore.getState().isDirty) {
      const error = new api.ApiError(
        409,
        'UNSAVED_CHANGES',
        'Save or discard your current changes before restoring a revision.',
      );
      set({ restoreError: error.message });
      throw error;
    }
    if (target.revision === expectedRevision) {
      const error = new api.ApiError(400, 'CANNOT_RESTORE_CURRENT_REVISION', 'The current revision cannot be restored.');
      set({ restoreError: error.message });
      throw error;
    }

    set({ isRestoring: true, restoreError: null });
    try {
      const restored = await api.restoreWorkflowRevision(workflowId, target.revision, { expectedRevision });
      set({
        previewRevision: null,
        editableSelectedNodeId: null,
        isRestoreDialogOpen: false,
        isPanelOpen: false,
        restoreError: null,
      });
      useUIStore.getState().selectNode(null);
      return restored;
    } catch (error) {
      set({ restoreError: restoreErrorMessage(error) });
      throw error;
    } finally {
      set({ isRestoring: false });
    }
  },

  reset: () => set((state) => ({
    ...initialState,
    historyRequestToken: state.historyRequestToken + 1,
    previewRequestToken: state.previewRequestToken + 1,
  })),
}));
