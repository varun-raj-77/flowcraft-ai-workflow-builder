// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workflow, WorkflowRevisionDetail, WorkflowRevisionSummary } from '@/types';
import { useWorkflowStore } from '@/stores/workflowStore';

const mocks = vi.hoisted(() => ({
  listWorkflowRevisions: vi.fn(),
  getWorkflowRevision: vi.fn(),
}));

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/lib/api');
  return {
    ...actual,
    listWorkflowRevisions: mocks.listWorkflowRevisions,
    getWorkflowRevision: mocks.getWorkflowRevision,
  };
});

import { useRevisionHistoryStore } from '@/stores/revisionHistoryStore';
import { RevisionHistoryPanel } from './RevisionHistoryPanel';

const workflow: Workflow = {
  _id: 'workflow-1',
  userId: 'user-1',
  name: 'History workflow',
  nodes: [],
  edges: [],
  isGeneratedByAI: false,
  currentRevision: 3,
  currentRevisionId: 'revision-3',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-03T00:00:00.000Z',
};

function item(
  revision: number,
  source: WorkflowRevisionSummary['source'] = 'manual',
): WorkflowRevisionSummary {
  return {
    id: `revision-${revision}`,
    revision,
    parentRevisionId: revision === 1 ? null : `revision-${revision - 1}`,
    source,
    definitionHash: String(revision).repeat(64),
    restoredFromRevisionId: source === 'restore' ? 'revision-1' : undefined,
    restoredFromRevision: source === 'restore' ? 1 : undefined,
    createdAt: `2026-08-0${revision}T00:00:00.000Z`,
    nodeCount: revision,
    edgeCount: Math.max(0, revision - 1),
  };
}

beforeEach(() => {
  useWorkflowStore.getState().setWorkflow(workflow);
  useRevisionHistoryStore.getState().reset();
  mocks.listWorkflowRevisions.mockReset();
  mocks.getWorkflowRevision.mockReset();
});

afterEach(cleanup);

describe('RevisionHistoryPanel', () => {
  it('opens, labels current/source metadata, and loads the next cursor page', async () => {
    mocks.listWorkflowRevisions
      .mockResolvedValueOnce({ revisions: [item(3), item(2, 'ai_generated')], nextBeforeRevision: 2 })
      .mockResolvedValueOnce({ revisions: [item(1, 'restore')], nextBeforeRevision: null });
    await act(() => useRevisionHistoryStore.getState().openHistory('workflow-1'));

    render(<RevisionHistoryPanel />);

    expect(screen.getByRole('dialog', { name: 'Revision history' })).toBeTruthy();
    expect(screen.getByText('Current')).toBeTruthy();
    expect(screen.getByText('AI generated')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

    await waitFor(() => expect(screen.getByText('Restored from v1')).toBeTruthy());
    expect(mocks.listWorkflowRevisions).toHaveBeenLastCalledWith('workflow-1', {
      limit: 20,
      beforeRevision: 2,
    });
  });

  it('selects an exact historical revision and enters preview mode', async () => {
    const detail: WorkflowRevisionDetail = {
      id: 'revision-1',
      workflowId: 'workflow-1',
      revision: 1,
      parentRevisionId: null,
      source: 'manual',
      definitionHash: '1'.repeat(64),
      nodes: [{ id: 'start', type: 'start', label: 'Historical start', position: { x: 0, y: 0 }, config: {} }],
      edges: [],
      createdAt: '2026-08-01T00:00:00.000Z',
    };
    mocks.listWorkflowRevisions.mockResolvedValue({ revisions: [item(3), item(1)], nextBeforeRevision: null });
    mocks.getWorkflowRevision.mockResolvedValue(detail);
    await act(() => useRevisionHistoryStore.getState().openHistory('workflow-1'));
    render(<RevisionHistoryPanel />);

    fireEvent.click(screen.getByRole('button', { name: 'View revision v1' }));

    await waitFor(() => expect(useRevisionHistoryStore.getState().previewRevision).toEqual(detail));
    expect(useRevisionHistoryStore.getState().isPanelOpen).toBe(false);
  });
});
