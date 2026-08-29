// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ExecutionRun, WorkflowRevisionComparison, WorkflowRevisionDetail } from '@/types';
import { useRevisionComparisonStore } from '@/stores/revisionComparisonStore';
import { useRevisionHistoryStore } from '@/stores/revisionHistoryStore';

const mocks = vi.hoisted(() => ({
  getExecutionRevisionProvenance: vi.fn(),
  compareWorkflowRevisions: vi.fn(),
  getWorkflowRevision: vi.fn(),
}));

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/lib/api');
  return {
    ...actual,
    getExecutionRevisionProvenance: mocks.getExecutionRevisionProvenance,
    compareWorkflowRevisions: mocks.compareWorkflowRevisions,
    getWorkflowRevision: mocks.getWorkflowRevision,
  };
});

import { ExecutionProvenanceCard } from './ExecutionProvenanceCard';

const hash = '1234567890abcdef'.repeat(4);
const run: ExecutionRun = {
  _id: 'run-1', workflowId: 'workflow-1', workflowRevisionId: 'revision-1', workflowRevision: 1,
  definitionHash: hash, userId: 'user-1', status: 'completed', startedAt: '2026-08-01T00:00:00.000Z',
  completedAt: '2026-08-01T00:00:01.000Z', triggerType: 'manual', stepLogs: [], executionOrder: [],
  createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:01.000Z',
};
const exactRevision: WorkflowRevisionDetail = {
  id: 'revision-1', workflowId: 'workflow-1', revision: 1, parentRevisionId: null, source: 'manual',
  definitionHash: hash, nodes: [], edges: [], createdAt: '2026-08-01T00:00:00.000Z',
};
const comparison: WorkflowRevisionComparison = {
  workflowId: 'workflow-1',
  from: { id: 'revision-1', revision: 1, source: 'manual', definitionHash: hash, createdAt: '2026-08-01T00:00:00.000Z' },
  to: { id: 'revision-2', revision: 2, source: 'manual', definitionHash: '2'.repeat(64), createdAt: '2026-08-02T00:00:00.000Z' },
  hasChanges: false,
  summary: { totalChanges: 0, nodes: { added: 0, removed: 0, modified: 0 }, edges: { added: 0, removed: 0, modified: 0 } },
  nodes: { added: [], removed: [], modified: [] }, edges: { added: [], removed: [], modified: [] }, graph: { nodes: [], edges: [] },
};

beforeEach(() => {
  useRevisionComparisonStore.getState().reset();
  useRevisionHistoryStore.getState().reset();
  mocks.getExecutionRevisionProvenance.mockReset();
  mocks.compareWorkflowRevisions.mockReset();
  mocks.getWorkflowRevision.mockReset();
});

afterEach(() => cleanup());

describe('ExecutionProvenanceCard', () => {
  it('shows pinned historical provenance and opens the directional executed-to-current comparison', async () => {
    mocks.getExecutionRevisionProvenance.mockResolvedValue({
      status: 'pinned', runId: 'run-1', workflowId: 'workflow-1', workflowRevision: 1,
      workflowRevisionId: 'revision-1', definitionHash: hash, currentRevision: 2,
      isCurrent: false, canView: true, canCompare: true,
    });
    mocks.compareWorkflowRevisions.mockResolvedValue(comparison);
    render(<ExecutionProvenanceCard run={run} />);

    expect(await screen.findByText(/Executed v1 · current v2/)).toBeTruthy();
    const abbreviated = screen.getByTitle(hash);
    expect(abbreviated.textContent).toContain('1234567890');
    fireEvent.click(screen.getByRole('button', { name: 'Compare executed → current' }));

    await waitFor(() => expect(mocks.compareWorkflowRevisions).toHaveBeenCalledWith('workflow-1', 1, 2));
    expect(useRevisionComparisonStore.getState().comparison).toEqual(comparison);
  });

  it('loads the exact pinned revision and verifies its hash before previewing it', async () => {
    mocks.getExecutionRevisionProvenance.mockResolvedValue({
      status: 'pinned', runId: 'run-1', workflowId: 'workflow-1', workflowRevision: 1,
      workflowRevisionId: 'revision-1', definitionHash: hash, currentRevision: 2,
      isCurrent: false, canView: true, canCompare: true,
    });
    mocks.getWorkflowRevision.mockResolvedValue(exactRevision);
    render(<ExecutionProvenanceCard run={run} />);

    fireEvent.click(await screen.findByRole('button', { name: 'View exact revision v1' }));

    await waitFor(() => expect(mocks.getWorkflowRevision).toHaveBeenCalledWith('workflow-1', 1));
    expect(useRevisionHistoryStore.getState().previewRevision).toEqual(exactRevision);
  });

  it('labels a legacy run without fabricating revision actions or calling provenance resolution', async () => {
    render(<ExecutionProvenanceCard run={{ ...run, workflowRevisionId: undefined, workflowRevision: undefined, definitionHash: undefined }} />);

    expect(await screen.findByText(/Legacy run/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /exact revision/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Compare executed/i })).toBeNull();
    expect(mocks.getExecutionRevisionProvenance).not.toHaveBeenCalled();
  });

  it('shows integrity failures and exposes no current-revision fallback action', async () => {
    mocks.getExecutionRevisionProvenance.mockResolvedValue({
      status: 'integrity_error', runId: 'run-1', workflowId: 'workflow-1', workflowRevision: 1,
      workflowRevisionId: 'revision-1', definitionHash: hash, currentRevision: 2,
      isCurrent: false, canView: false, canCompare: false,
      message: 'The execution hash does not match its pinned workflow revision.',
    });
    render(<ExecutionProvenanceCard run={run} />);

    expect(await screen.findByText(/does not match/)).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
