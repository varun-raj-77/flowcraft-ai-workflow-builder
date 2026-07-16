import { create } from 'zustand';

interface UIState {
  // State
  selectedNodeId: string | null;
  isConfigPanelOpen: boolean;
  isExecutionPanelOpen: boolean;
  isExecutionInspectorMaximized: boolean;
  isAIModalOpen: boolean;

  // Actions
  selectNode: (nodeId: string | null) => void;
  toggleExecutionPanel: () => void;
  setExecutionPanelOpen: (isOpen: boolean) => void;
  maximizeExecutionInspector: () => void;
  restoreExecutionInspector: () => void;
  openAIModal: () => void;
  closeAIModal: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  selectedNodeId: null,
  isConfigPanelOpen: false,
  isExecutionPanelOpen: false,
  isExecutionInspectorMaximized: false,
  isAIModalOpen: false,

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
}));
