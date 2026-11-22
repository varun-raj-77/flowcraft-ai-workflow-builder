// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '@/lib/api';
import { useWorkflowStore } from '@/stores/workflowStore';
import type { Workflow } from '@/types';

const mocks = vi.hoisted(() => ({ getWorkflow: vi.fn(), useParams: vi.fn() }));

vi.mock('next/navigation', () => ({ useParams: mocks.useParams }));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof api>(),
  getWorkflow: mocks.getWorkflow,
}));
vi.mock('@/features/workflow-canvas/CanvasToolbar', () => ({
  CanvasToolbar: () => <button type="button">Save</button>,
}));
vi.mock('@/features/workflow-canvas/NodePalette', () => ({ NodePalette: () => null }));
vi.mock('@/features/workflow-canvas/WorkflowCanvas', () => ({ WorkflowCanvas: () => null }));
vi.mock('@/features/node-config/ConfigPanel', () => ({ ConfigPanel: () => null }));
vi.mock('@/features/execution-viewer/ExecutionPanel', () => ({ ExecutionPanel: () => null }));
vi.mock('@/features/test-lab/TestLabPanel', () => ({ TestLabPanel: () => null }));
vi.mock('@/features/ai-generator/AIGeneratorModal', () => ({ AIGeneratorModal: () => null }));
vi.mock('@/features/revision-history/HistoricalRevisionBanner', () => ({ HistoricalRevisionBanner: () => null }));
vi.mock('@/features/revision-history/RevisionHistoryPanel', () => ({ RevisionHistoryPanel: () => null }));
vi.mock('@/features/revision-comparison/RevisionComparisonBanner', () => ({ RevisionComparisonBanner: () => null }));
vi.mock('@/features/revision-comparison/RevisionComparisonPanel', () => ({ RevisionComparisonPanel: () => null }));

import EditorPage from './page';

function workflow(id: string): Workflow {
  return {
    _id: id,
    name: id,
    userId: 'local-test-user',
    nodes: [],
    edges: [],
    isGeneratedByAI: false,
    createdAt: '2026-07-23T00:00:00.000Z',
    updatedAt: '2026-07-23T00:00:00.000Z',
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  mocks.useParams.mockReturnValue({ workflowId: 'first' });
  mocks.getWorkflow.mockReset();
  useWorkflowStore.getState().clearWorkflow();
});

afterEach(cleanup);

describe('workflow editor loading', () => {
  it('withholds editor actions until the workflow is loaded and retries transient errors', async () => {
    const first = deferred<Workflow>();
    const retry = deferred<Workflow>();
    mocks.getWorkflow.mockReturnValueOnce(first.promise).mockReturnValueOnce(retry.promise);
    render(<EditorPage />);

    expect(screen.getByRole('status').textContent).toContain('Loading workflow');
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();

    await act(async () => { first.reject(new api.ApiError(503, 'UNAVAILABLE', 'Try later.')); });
    expect(screen.getByRole('heading', { name: 'Could not load workflow' })).toBeTruthy();
    expect(screen.getByText('Try later.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(mocks.getWorkflow.mock.calls.map(([id]) => id)).toEqual(['first', 'first']);

    await act(async () => { retry.resolve(workflow('first')); });
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
    expect(useWorkflowStore.getState().meta?._id).toBe('first');
  });

  it('offers the dashboard but no retry for a missing workflow', async () => {
    mocks.getWorkflow.mockRejectedValue(new api.ApiError(404, 'NOT_FOUND', 'Missing.'));
    render(<EditorPage />);

    expect(await screen.findByRole('heading', { name: 'Workflow not found' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Back to Dashboard' }).getAttribute('href')).toBe('/dashboard');
  });

  it.each(['resolve', 'reject'] as const)(
    'ignores a departed workflow load that settles by %s after a later route loads',
    async (settle) => {
      const first = deferred<Workflow>();
      const second = deferred<Workflow>();
      mocks.getWorkflow.mockImplementation((id: string) => id === 'first' ? first.promise : second.promise);
      const { rerender } = render(<EditorPage />);
      const oldSignal = mocks.getWorkflow.mock.calls[0][1] as AbortSignal;
      expect(oldSignal.aborted).toBe(false);

      mocks.useParams.mockReturnValue({ workflowId: 'second' });
      rerender(<EditorPage />);
      expect(oldSignal.aborted).toBe(true);
      expect(screen.getByRole('status')).toBeTruthy();
      await act(async () => { second.resolve(workflow('second')); });
      expect(useWorkflowStore.getState().meta?._id).toBe('second');

      // Deliberately settle despite the abort to exercise the stale-write guard.
      await act(async () => {
        if (settle === 'resolve') first.resolve(workflow('first'));
        else first.reject(new api.ApiError(503, 'UNAVAILABLE', 'Stale error.'));
      });
      expect(useWorkflowStore.getState().meta?._id).toBe('second');
      expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
      expect(screen.queryByText('Stale error.')).toBeNull();
    },
  );
});
