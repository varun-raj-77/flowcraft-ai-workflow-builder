// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workflow, WorkflowRevisionDetail } from '@/types';
import { useWorkflowStore } from '@/stores/workflowStore';

const mocks = vi.hoisted(() => ({
  restoreWorkflowRevision: vi.fn(),
  listWorkflowRevisions: vi.fn(),
}));

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/lib/api');
  return {
    ...actual,
    restoreWorkflowRevision: mocks.restoreWorkflowRevision,
    listWorkflowRevisions: mocks.listWorkflowRevisions,
  };
});

import { useRevisionHistoryStore } from '@/stores/revisionHistoryStore';
import { HistoricalRevisionBanner } from './HistoricalRevisionBanner';

const workflow: Workflow = {
  _id: 'workflow-1',
  userId: 'user-1',
  name: 'Restore workflow',
  nodes: [{ id: 'start', type: 'start', label: 'Current start', position: { x: 0, y: 0 }, config: {} }],
  edges: [],
  isGeneratedByAI: false,
  currentRevision: 3,
  currentRevisionId: 'revision-3',
  definitionHash: '3'.repeat(64),
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-03T00:00:00.000Z',
};

const preview: WorkflowRevisionDetail = {
  id: 'revision-1',
  workflowId: 'workflow-1',
  revision: 1,
  parentRevisionId: null,
  source: 'manual',
  definitionHash: '1'.repeat(64),
  nodes: [{ id: 'start', type: 'start', label: 'Restored start', position: { x: 10, y: 20 }, config: {} }],
  edges: [],
  createdAt: '2026-08-01T00:00:00.000Z',
};

beforeEach(() => {
  useWorkflowStore.getState().setWorkflow(workflow);
  useRevisionHistoryStore.getState().reset();
  useRevisionHistoryStore.setState({ previewRevision: preview });
  mocks.restoreWorkflowRevision.mockReset();
  mocks.listWorkflowRevisions.mockReset().mockResolvedValue({ revisions: [], nextBeforeRevision: null });
});

afterEach(cleanup);

describe('HistoricalRevisionBanner', () => {
  it('makes historical mode obvious and disables restore while the current draft is dirty', () => {
    useWorkflowStore.getState().updateNodeData('start', { label: 'Unsaved current start' });
    render(<HistoricalRevisionBanner />);

    expect(screen.getByText('Viewing v1')).toBeTruthy();
    expect(screen.getByText('Historical revision · Read only')).toBeTruthy();
    expect(screen.getByText(/Save or discard your current changes/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Restore v1' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('confirms restore as a new revision and hydrates the clean returned current workflow', async () => {
    const restored: Workflow = {
      ...workflow,
      nodes: preview.nodes,
      currentRevision: 4,
      currentRevisionId: 'revision-4',
      definitionHash: preview.definitionHash,
      updatedAt: '2026-08-04T00:00:00.000Z',
    };
    mocks.restoreWorkflowRevision.mockResolvedValue(restored);
    render(<HistoricalRevisionBanner />);

    fireEvent.click(screen.getByRole('button', { name: 'Restore v1' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Restore v1?' });
    expect(dialog.textContent).toContain('create a new revision');
    expect(dialog.textContent).toContain('Current history will not be deleted');
    expect(dialog.textContent).toContain('v4');
    fireEvent.click(screen.getByRole('button', { name: 'Restore as new revision' }));

    await waitFor(() => expect(useWorkflowStore.getState().meta?.currentRevision).toBe(4));
    expect(mocks.restoreWorkflowRevision).toHaveBeenCalledWith('workflow-1', 1, { expectedRevision: 3 });
    expect(useWorkflowStore.getState().toWorkflowNodes()).toEqual(preview.nodes);
    expect(useWorkflowStore.getState()).toMatchObject({ isDirty: false, undoStack: [], redoStack: [] });
    expect(useRevisionHistoryStore.getState().previewRevision).toBeNull();
    await act(async () => undefined);
  });
});
