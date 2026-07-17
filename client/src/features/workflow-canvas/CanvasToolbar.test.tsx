// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CanvasToolbar } from './CanvasToolbar';
import { useWorkflowStore } from '@/stores/workflowStore';
import { useUIStore } from '@/stores/uiStore';

vi.mock('./hooks/useSaveWorkflow', () => ({ useSaveWorkflow: () => ({ save: vi.fn(), status: 'idle' }) }));
vi.mock('./hooks/useRunWorkflow', () => ({ useRunWorkflow: () => ({ run: vi.fn(), isRunning: false }) }));
vi.mock('./hooks/useKeyboardShortcuts', () => ({ useKeyboardShortcuts: () => undefined }));

describe('CanvasToolbar', () => {
  it('renders preflight from workflow store selectors without unscoped nodes', () => {
    useWorkflowStore.setState({ nodes: [], edges: [], meta: null, isDirty: false });
    useUIStore.setState({ isAIModalOpen: false });
    render(<CanvasToolbar />);
    expect(screen.getByRole('button', { name: '1 issues' })).toBeTruthy();
  });
});
