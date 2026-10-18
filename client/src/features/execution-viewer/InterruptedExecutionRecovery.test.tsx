// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as api from '@/lib/api';
import { useExecutionStore } from '@/stores/executionStore';
import { useWorkflowStore } from '@/stores/workflowStore';
import { useUIStore } from '@/stores/uiStore';
import type { ExecutionRun } from '@/types';
import { InterruptedExecutionRecovery, INTERRUPTED_EXECUTION_MESSAGE } from './InterruptedExecutionRecovery';

const source: ExecutionRun = {
  _id: 'source-1', workflowId: 'workflow-1', userId: 'owner', status: 'failed',
  triggerType: 'manual', workflowRevision: 1, definitionHash: 'a'.repeat(64),
  error: INTERRUPTED_EXECUTION_MESSAGE,
  stepLogs: [
    { nodeId: 'one', nodeType: 'start', nodeLabel: 'Start', status: 'success' },
    { nodeId: 'two', nodeType: 'api_call', nodeLabel: 'Post to external API', status: 'failed' },
    { nodeId: 'three', nodeType: 'output', nodeLabel: 'Output', status: 'skipped' },
  ],
  executionOrder: ['one', 'two', 'three'],
  startedAt: '2026-10-18T12:00:00Z', completedAt: '2026-10-18T12:04:00Z',
  createdAt: '2026-10-18T12:00:00Z', updatedAt: '2026-10-18T12:04:00Z',
};

beforeEach(() => {
  vi.restoreAllMocks();
  useWorkflowStore.setState({ meta: { _id: 'workflow-1', name: 'Test', isGeneratedByAI: false }, isDirty: false });
  useExecutionStore.setState({ currentRun: source, isRunning: false, activeInspectorTab: 'history' });
  useUIStore.setState({ isExecutionPanelOpen: false });
});
afterEach(cleanup);

describe('interrupted execution recovery controls', () => {
  it('does not offer retry for ordinary failures or an active run', () => {
    const { rerender } = render(<InterruptedExecutionRecovery run={{ ...source, error: 'HTTP 500' }} />);
    expect(screen.queryByRole('button', { name: /Start one new attempt/ })).toBeNull();
    rerender(<InterruptedExecutionRecovery run={{ ...source, status: 'running' }} />);
    expect(screen.queryByRole('button', { name: /Start one new attempt/ })).toBeNull();
  });

  it('explains uncertain external effects and requires opt-in', () => {
    render(<InterruptedExecutionRecovery run={source} />);
    expect(screen.getByText(/1 completed .* 1 interrupted .* 1 not run/)).toBeTruthy();
    expect(screen.getByText(/may already have changed an external system/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Start one new attempt' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: /Acknowledge possible duplicate external side effects/ }));
    expect((screen.getByRole('button', { name: 'Start one new attempt' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('creates one retry and switches the inspector to the new run', async () => {
    const next: ExecutionRun = {
      ...source, _id: 'new-run', retryOfRunId: source._id,
      status: 'running', error: undefined,
      stepLogs: source.stepLogs.map((s) => ({ ...s, status: 'pending' as const })),
    };
    const request = vi.spyOn(api, 'retryInterruptedExecution').mockResolvedValue(next);
    render(<InterruptedExecutionRecovery run={source} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /Acknowledge possible duplicate external side effects/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Start one new attempt' }));
    await waitFor(() => expect(useExecutionStore.getState().currentRun?._id).toBe('new-run'));
    expect(request).toHaveBeenCalledExactlyOnceWith('source-1');
    expect(useExecutionStore.getState().activeInspectorTab).toBe('live');
    expect(useUIStore.getState().isExecutionPanelOpen).toBe(true);
  });

  it('prevents a second click during an unresolved request', async () => {
    let finish!: (run: ExecutionRun) => void;
    const request = vi.spyOn(api, 'retryInterruptedExecution').mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    render(<InterruptedExecutionRecovery run={source} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /Acknowledge possible duplicate external side effects/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Start one new attempt' }));
    fireEvent.click(screen.getByRole('button', { name: /Creating attempt/ }));
    expect(request).toHaveBeenCalledTimes(1);
    finish({ ...source, _id: 'new-run', status: 'running' });
    await waitFor(() => expect(useExecutionStore.getState().currentRun?._id).toBe('new-run'));
  });

  it('disables the retry if the workflow is dirty or another run is active', () => {
    useWorkflowStore.setState({ isDirty: true });
    const { rerender } = render(<InterruptedExecutionRecovery run={source} />);
    expect((screen.getByRole('button', { name: 'Start one new attempt' }) as HTMLButtonElement).disabled).toBe(true);
    useWorkflowStore.setState({ isDirty: false });
    useExecutionStore.setState({ isRunning: true });
    rerender(<InterruptedExecutionRecovery run={source} />);
    expect((screen.getByRole('button', { name: 'Start one new attempt' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows server revision-conflict errors without creating a local run', async () => {
    vi.spyOn(api, 'retryInterruptedExecution').mockRejectedValue(new api.ApiError(409, 'RETRY_REVISION_CHANGED', 'The workflow revision has changed.'));
    render(<InterruptedExecutionRecovery run={source} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /Acknowledge possible duplicate external side effects/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Start one new attempt' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'The workflow revision has changed.');
    expect(useExecutionStore.getState().currentRun?._id).toBe('source-1');
  });
});
