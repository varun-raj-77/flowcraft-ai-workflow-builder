import { create } from 'zustand';

interface UIState {
  // State
  selectedNodeId: string | null;
  isConfigPanelOpen: boolean;
  isExecutionPanelOpen: boolean;
  isAIModalOpen: boolean;

  // Actions
  selectNode: (nodeId: string | null) => void;
  toggleExecutionPanel: () => void;
  openAIModal: () => void;
  closeAIModal: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  selectedNodeId: null,
  isConfigPanelOpen: false,
  isExecutionPanelOpen: false,
  isAIModalOpen: false,

  selectNode: (nodeId) =>
    set({
      selectedNodeId: nodeId,
      isConfigPanelOpen: nodeId !== null,
    }),

  toggleExecutionPanel: () =>
    set((state) => ({
      isExecutionPanelOpen: !state.isExecutionPanelOpen,
    })),

  openAIModal: () => set({ isAIModalOpen: true }),
  closeAIModal: () => set({ isAIModalOpen: false }),
}));
