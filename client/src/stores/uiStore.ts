import { create } from 'zustand';

interface UIState {
  // State
  selectedNodeId: string | null;
  isConfigPanelOpen: boolean;
  isExecutionPanelOpen: boolean;
  isExecutionInspectorMaximized: boolean;
  isAIModalOpen: boolean;
  undoToast: string | null;

  // Actions
  selectNode: (nodeId: string | null) => void;
  toggleExecutionPanel: () => void;
  setExecutionPanelOpen: (isOpen: boolean) => void;
  maximizeExecutionInspector: () => void;
  restoreExecutionInspector: () => void;
  openAIModal: () => void;
  closeAIModal: () => void;
  showUndoToast: (message: string) => void;
  clearUndoToast: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  selectedNodeId: null,
  isConfigPanelOpen: false,
  isExecutionPanelOpen: false,
  isExecutionInspectorMaximized: false,
  isAIModalOpen: false,
  undoToast: null,

  selectNode: (nodeId) =>
    set({
      selectedNodeId: nodeId,
      isConfigPanelOpen: nodeId !== null,
    }),

  toggleExecutionPanel: () =>
    set((state) => ({
      isExecutionPanelOpen: !state.isExecutionPanelOpen,
      isExecutionInspectorMaximized: state.isExecutionPanelOpen ? false : state.isExecutionInspectorMaximized,
    })),

  setExecutionPanelOpen: (isOpen) => set({ isExecutionPanelOpen: isOpen, isExecutionInspectorMaximized: false }),
  maximizeExecutionInspector: () => set({ isExecutionPanelOpen: true, isExecutionInspectorMaximized: true }),
  restoreExecutionInspector: () => set({ isExecutionInspectorMaximized: false }),

  openAIModal: () => set({ isAIModalOpen: true }),
  closeAIModal: () => set({ isAIModalOpen: false }),
  showUndoToast: (undoToast) => set({ undoToast }),
  clearUndoToast: () => set({ undoToast: null }),
}));
