import { create } from 'zustand';

interface UIState {
  // State
  selectedNodeId: string | null;
  nodeFocusRequest: { nodeId: string; workflowId: string; sequence: number } | null;
  isConfigPanelOpen: boolean;
  isExecutionPanelOpen: boolean;
  isExecutionInspectorMaximized: boolean;
  isAIModalOpen: boolean;
  isTestLabOpen: boolean;
  undoToast: string | null;

  // Actions
  selectNode: (nodeId: string | null) => void;
  requestNodeFocus: (nodeId: string, workflowId: string) => void;
  clearNodeFocusRequest: () => void;
  toggleExecutionPanel: () => void;
  setExecutionPanelOpen: (isOpen: boolean) => void;
  maximizeExecutionInspector: () => void;
  restoreExecutionInspector: () => void;
  openAIModal: () => void;
  closeAIModal: () => void;
  openTestLab: () => void;
  closeTestLab: () => void;
  showUndoToast: (message: string) => void;
  clearUndoToast: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  selectedNodeId: null,
  nodeFocusRequest: null,
  isConfigPanelOpen: false,
  isExecutionPanelOpen: false,
  isExecutionInspectorMaximized: false,
  isAIModalOpen: false,
  isTestLabOpen: false,
  undoToast: null,

  selectNode: (nodeId) =>
    set({
      selectedNodeId: nodeId,
      isConfigPanelOpen: nodeId !== null,
    }),

  requestNodeFocus: (nodeId, workflowId) => set((state) => ({
    selectedNodeId: nodeId,
    isConfigPanelOpen: true,
    nodeFocusRequest: { nodeId, workflowId, sequence: (state.nodeFocusRequest?.sequence ?? 0) + 1 },
  })),
  clearNodeFocusRequest: () => set({ nodeFocusRequest: null }),

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
  openTestLab: () => set({ isTestLabOpen: true, isAIModalOpen: false }),
  closeTestLab: () => set({ isTestLabOpen: false }),
  showUndoToast: (undoToast) => set({ undoToast }),
  clearUndoToast: () => set({ undoToast: null }),
}));
