// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

    for (const name of ['Undo', 'Redo', '◈ Test Lab', '✦ AI Generate', 'Save', 'Run']) {
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

    for (const name of ['Undo', 'Redo', '◈ Test Lab', '✦ AI Generate', 'Save', 'Run']) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
    }
    expect(screen.getByText('v2')).toBeTruthy();
  });
});


describe('M13 searchable node navigation', () => {
  const graphNodes = [
    { id: 'one', type: 'transform', position: { x: 0, y: 0 }, data: { label: 'Parse Orders', nodeType: 'transform', config: { transformCode: 'return data' } } },
    { id: 'two', type: 'api_call', position: { x: 100, y: 0 }, data: { label: 'Fetch Customers', nodeType: 'api_call', config: { url: 'https://example.test', method: 'GET' } } },
  ];
  beforeEach(() => {
    useWorkflowStore.setState({ nodes: graphNodes, edges: [], isDirty: false,
      meta: { _id: 'workflow-m13', name: 'Find demo', isGeneratedByAI: false },
      undoStack: [], redoStack: [] });
    useUIStore.setState({ selectedNodeId: null, isConfigPanelOpen: false, nodeFocusRequest: null });
    useRevisionHistoryStore.getState().reset();
    useRevisionComparisonStore.getState().reset();
  });
  it('finds an existing node by label and selects it without editing the graph', () => {
    render(<CanvasToolbar />);
    fireEvent.click(screen.getByRole('button', { name: 'Find node' }));
    const search = screen.getByRole('searchbox', { name: 'Search workflow nodes' });
    fireEvent.change(search, { target: { value: 'customers' } });
    expect(screen.getByRole('button', { name: /Fetch Customers/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Parse Orders/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Fetch Customers/ }));
    const ui = useUIStore.getState();
    expect(ui.selectedNodeId).toBe('two');
    expect(ui.isConfigPanelOpen).toBe(true);
    expect(ui.nodeFocusRequest).toMatchObject({ nodeId: 'two', workflowId: 'workflow-m13' });
    expect(useWorkflowStore.getState().isDirty).toBe(false);
    expect(useWorkflowStore.getState().undoStack).toHaveLength(0);
  });
  it('handles empty matches, Enter and Escape without changing execution data', () => {
    render(<CanvasToolbar />);
    fireEvent.click(screen.getByRole('button', { name: 'Find node' }));
    const search = screen.getByRole('searchbox', { name: 'Search workflow nodes' });
    fireEvent.change(search, { target: { value: 'does not exist' } });
    expect(screen.getByText(/No matching nodes in this workflow/)).toBeTruthy();
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(useUIStore.getState().nodeFocusRequest).toBeNull();
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Find workflow node' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Find node' }));
  });
  it('opens Ctrl+K when not typing and cannot open in read-only revision mode', () => {
    const { rerender } = render(<CanvasToolbar />);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.getByRole('dialog', { name: 'Find workflow node' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    useRevisionHistoryStore.setState({ previewRevision: {
      id: 'revision-old', workflowId: 'workflow-m13', revision: 1,
      parentRevisionId: null, source: 'manual', definitionHash: '1'.repeat(64),
      nodes: [], edges: [], createdAt: '2026-10-18T12:00:00Z',
    } });
    rerender(<CanvasToolbar />);
    expect((screen.getByRole('button', { name: 'Find node' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.queryByRole('dialog', { name: 'Find workflow node' })).toBeNull();
  });
  it('focuses an invalid preflight node on the canvas rather than merely selecting its form', () => {
    render(<CanvasToolbar />);
    fireEvent.click(screen.getByRole('button', { name: /issues|warnings/ }));
    const focus = screen.getAllByRole('button', { name: 'Focus' })[0];
    fireEvent.click(focus);
    expect(useUIStore.getState().nodeFocusRequest?.nodeId).toBeTruthy();
    expect(useUIStore.getState().nodeFocusRequest?.workflowId).toBe('workflow-m13');
  });
});
