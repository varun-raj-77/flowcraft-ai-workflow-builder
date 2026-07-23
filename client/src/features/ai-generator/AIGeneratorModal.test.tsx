// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  applyGeneratedWorkflow: vi.fn(),
  closeModal: vi.fn(),
  generateWorkflow: vi.fn(),
  push: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/stores/uiStore', () => ({
  useUIStore: (selector: (state: { isAIModalOpen: boolean; closeAIModal: () => void }) => unknown) => selector({
    isAIModalOpen: true,
    closeAIModal: mocks.closeModal,
  }),
}));
vi.mock('@/stores/workflowStore', () => ({
  useWorkflowStore: (selector: (state: { applyGeneratedWorkflow: typeof mocks.applyGeneratedWorkflow }) => unknown) => selector({
    applyGeneratedWorkflow: mocks.applyGeneratedWorkflow,
  }),
}));
vi.mock('@/lib/api', () => ({ generateWorkflow: mocks.generateWorkflow }));

import { AIGeneratorModal } from './AIGeneratorModal';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AIGeneratorModal validation', () => {
  it('provides dialog semantics and closes with Escape', () => {
    render(<AIGeneratorModal />);

    expect(screen.getByRole('dialog', { name: '✦ Generate with AI' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByPlaceholderText(/Fetch data from an API/i));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(mocks.closeModal).toHaveBeenCalledTimes(1);
  });

  it('keeps incomplete generated graphs out of the workflow store', async () => {
    mocks.generateWorkflow.mockResolvedValue({
      name: 'Incomplete workflow',
      nodes: [],
      edges: [],
      generationMetadata: {
        originalPrompt: 'Fetch customer data',
        generatedAt: '2026-07-16T00:00:00.000Z',
        capabilityCoverage: {
          requestedCapabilities: ['api_call'],
          implementedCapabilities: [],
          missingCapabilities: ['api_call'],
          unsupportedCapabilities: [],
          coverage: 0,
          isComplete: false,
        },
      },
    });

    render(<AIGeneratorModal />);
    fireEvent.change(screen.getByPlaceholderText(/Fetch data from an API/i), { target: { value: 'Fetch customer data' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate Workflow' }));

    await waitFor(() => expect(screen.getByText('Missing components')).toBeTruthy());
    expect(mocks.applyGeneratedWorkflow).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });
});
