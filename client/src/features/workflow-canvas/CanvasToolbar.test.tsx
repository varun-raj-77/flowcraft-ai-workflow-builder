// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { CanvasToolbar } from './CanvasToolbar';
import { useWorkflowStore } from '@/stores/workflowStore';
import { useUIStore } from '@/stores/uiStore';
import { useRevisionHistoryStore } from '@/stores/revisionHistoryStore';
import { useRevisionComparisonStore } from '@/stores/revisionComparisonStore';

vi.mock('./hooks/useSaveWorkflow', () => ({ useSaveWorkflow: () => ({ save: vi.fn(), status: 'idle' }) }));
vi.mock('./hooks/useRunWorkflow', () => ({ useRunWorkflow: () => ({ run: vi.fn(), isRunning: false }) }));
vi.mock('./hooks/useKeyboardShortcuts', () => ({ useKeyboardShortcuts: () => undefined }));

afterEach(() => {
  cleanup();
  useRevisionHistoryStore.getState().reset();
  useRevisionComparisonStore.getState().reset();
});

describe('CanvasToolbar', () => {
  it('renders preflight from workflow store selectors without unscoped nodes', () => {
    useWorkflowStore.setState({ nodes: [], edges: [], meta: null, isDirty: false });
    useUIStore.setState({ isAIModalOpen: false });
    render(<CanvasToolbar />);
    expect(screen.getByRole('button', { name: '1 issues' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Redo' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('disables every mutation, run, and AI action during historical preview', () => {
    useWorkflowStore.setState({
      nodes: [],
      edges: [],
      meta: {
        _id: 'workflow-1',
        name: 'Workflow',
        isGeneratedByAI: true,
        currentRevision: 3,
        currentRevisionId: 'revision-3',
      },
      isDirty: false,
      undoStack: [{ nodes: [], edges: [], meta: null }],
      redoStack: [{ nodes: [], edges: [], meta: null }],
    });
    useRevisionHistoryStore.setState({
      previewRevision: {
        id: 'revision-1',
        workflowId: 'workflow-1',
        revision: 1,
        parentRevisionId: null,
        source: 'manual',
        definitionHash: '1'.repeat(64),
        nodes: [],
        edges: [],
        createdAt: '2026-08-01T00:00:00.000Z',
      },
    });

    render(<CanvasToolbar />);

    for (const name of ['Undo', 'Redo', '✦ AI Generate', 'Save', 'Run']) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
    }
    expect(screen.getByText('v1')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Workflow' })).toBeNull();
  });

  it('disables editor mutations and execution during read-only comparison mode', () => {
    useWorkflowStore.setState({
      nodes: [], edges: [],
      meta: { _id: 'workflow-1', name: 'Workflow', isGeneratedByAI: false, currentRevision: 2, currentRevisionId: 'revision-2' },
      isDirty: true,
      undoStack: [{ nodes: [], edges: [], meta: null }],
      redoStack: [{ nodes: [], edges: [], meta: null }],
    });
    useRevisionComparisonStore.setState({
      comparison: {
        workflowId: 'workflow-1',
        from: { id: 'revision-1', revision: 1, source: 'manual', definitionHash: '1'.repeat(64), createdAt: '2026-08-01T00:00:00.000Z' },
        to: { id: 'revision-2', revision: 2, source: 'manual', definitionHash: '2'.repeat(64), createdAt: '2026-08-02T00:00:00.000Z' },
        hasChanges: false,
        summary: { totalChanges: 0, nodes: { added: 0, removed: 0, modified: 0 }, edges: { added: 0, removed: 0, modified: 0 } },
        nodes: { added: [], removed: [], modified: [] }, edges: { added: [], removed: [], modified: [] }, graph: { nodes: [], edges: [] },
      },
    });

    render(<CanvasToolbar />);

    for (const name of ['Undo', 'Redo', '✦ AI Generate', 'Save', 'Run']) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
    }
    expect(screen.getByText('v2')).toBeTruthy();
  });
});
