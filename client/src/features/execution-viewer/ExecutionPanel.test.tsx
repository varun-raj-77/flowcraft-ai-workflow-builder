// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as api from '@/lib/api';
import { ExecutionPanel } from './ExecutionPanel';
import { useExecutionStore } from '@/stores/executionStore';
import { useWorkflowStore } from '@/stores/workflowStore';
import { useUIStore } from '@/stores/uiStore';
import type { ExecutionRun } from '@/types';

const liveRun: ExecutionRun = {
  _id: 'live_run', workflowId: 'workflow_1', userId: 'user_1', status: 'completed', triggerType: 'manual',
  startedAt: '2026-07-15T10:00:00.000Z', completedAt: '2026-07-15T10:00:02.000Z',
  createdAt: '2026-07-15T10:00:00.000Z', updatedAt: '2026-07-15T10:00:02.000Z', executionOrder: ['node_1'],
  stepLogs: [{ nodeId: 'node_1', nodeType: 'api_call', nodeLabel: 'Fetch users', status: 'success', durationMs: 2000, input: { Authorization: 'Bearer hidden' }, output: { status: 200, data: [{ id: 1 }, { id: 2 }], headers: { 'content-type': 'application/json' }, token: 'hidden' } }],
};

const historicalRun: ExecutionRun = {
  ...liveRun,
  _id: 'history_run',
  status: 'failed',
  stepLogs: [{ nodeId: 'node_2', nodeType: 'output', nodeLabel: 'Log failure', status: 'failed', startedAt: '2026-07-15T10:00:01.000Z', completedAt: '2026-07-15T10:00:02.000Z', durationMs: 1000, error: 'Request failed' }],
  executionOrder: ['node_2'],
};

function setPersistedWorkflow() {
  useWorkflowStore.setState({ meta: { _id: 'workflow_1', name: 'Workflow', isGeneratedByAI: false } });
}

beforeEach(() => {
  vi.restoreAllMocks();
  useExecutionStore.setState({
    currentRun: liveRun, isRunning: false, lastError: null, historyRuns: [], historyWorkflowId: null, selectedHistoricalRunId: null,
    historyStatus: 'idle', historyError: null, selectedStepNodeId: null, activeInspectorTab: 'live',
  });
  useWorkflowStore.setState({ meta: null, nodes: [], edges: [], isDirty: false });
  window.localStorage.clear();
  useUIStore.setState({ selectedNodeId: null, isConfigPanelOpen: false, isExecutionPanelOpen: true, isExecutionInspectorMaximized: false, isAIModalOpen: false });
});

afterEach(cleanup);

describe('ExecutionPanel', () => {
  it('loads history for a persisted workflow and keeps the active live run when a historical run is selected', async () => {
    setPersistedWorkflow();
    vi.spyOn(api, 'listExecutions').mockResolvedValue([historicalRun]);
    render(<ExecutionPanel />);

    fireEvent.click(screen.getByRole('tab', { name: 'History' }));
    await screen.findByText(/failed · manual/i);
    fireEvent.click(screen.getByText(/failed · manual/i));

    expect(useExecutionStore.getState().selectedHistoricalRunId).toBe('history_run');
    expect(useExecutionStore.getState().currentRun?._id).toBe('live_run');
    expect(screen.getByRole('tab', { name: 'Timeline' }).getAttribute('aria-selected')).toBe('true');
  });

  it('does not request history for an unsaved workflow', async () => {
    const listExecutions = vi.spyOn(api, 'listExecutions');
    render(<ExecutionPanel />);
    fireEvent.click(screen.getByRole('tab', { name: 'History' }));
    expect(await screen.findByText(/Save this workflow before viewing execution history/i)).toBeTruthy();
    expect(listExecutions).not.toHaveBeenCalled();
  });

  it('renders an empty history state', async () => {
    setPersistedWorkflow();
    vi.spyOn(api, 'listExecutions').mockResolvedValue([]);
    render(<ExecutionPanel />);
    fireEvent.click(screen.getByRole('tab', { name: 'History' }));
    expect(await screen.findByText(/No executions have been recorded/i)).toBeTruthy();
  });

  it('renders a typed history error and retries', async () => {
    setPersistedWorkflow();
    const listExecutions = vi.spyOn(api, 'listExecutions')
      .mockRejectedValueOnce(new api.ApiError(401, 'MISSING_TOKEN', 'Authentication required'))
      .mockResolvedValueOnce([]);
    render(<ExecutionPanel />);
    fireEvent.click(screen.getByRole('tab', { name: 'History' }));
    expect(await screen.findByText(/Your session has expired/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(listExecutions).toHaveBeenCalledTimes(2));
  });

  it('selects the matching canvas node from a timeline row while live updates continue to target currentRun', () => {
    useExecutionStore.setState({ historyRuns: [historicalRun], selectedHistoricalRunId: 'history_run', activeInspectorTab: 'timeline' });
    render(<ExecutionPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Log failure/i }));
    expect(useUIStore.getState().selectedNodeId).toBe('node_2');

    useExecutionStore.getState().updateNodeStatus('node_1', { status: 'failed' });
    expect(useExecutionStore.getState().currentRun?.stepLogs[0].status).toBe('failed');
    expect(useExecutionStore.getState().selectedHistoricalRunId).toBe('history_run');
  });

  it('redacts recorded configuration and output values before display', () => {
    render(<ExecutionPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Fetch users/i }));
    expect(screen.getAllByText(/REDACTED/).length).toBeGreaterThan(0);
    expect(screen.queryByText('hidden')).toBeNull();
    expect(screen.getByText(/Response metadata: HTTP 200 .* 2 items .* application\/json/)).toBeTruthy();
  });

  it('supports keyboard tab navigation', () => {
    render(<ExecutionPanel />);
    const liveTab = screen.getByRole('tab', { name: 'Live' });
    liveTab.focus();
    fireEvent.keyDown(liveTab, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Timeline' }).getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Timeline' }));
  });

  it('resizes within bounds and persists the user preference', () => {
    const { container } = render(<ExecutionPanel />);
    const handle = screen.getByRole('slider', { name: 'Resize execution inspector' });
    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 500 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 380 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientY: 380 });
    expect(Number(handle.getAttribute('aria-valuenow'))).toBeGreaterThan(288);
    expect(Number(window.localStorage.getItem('flowcraft.executionInspector.height'))).toBeGreaterThan(288);
    expect(container.querySelector('[aria-label="Execution Inspector"]')).toBeTruthy();
  });

  it('clamps resize height and safely restores a valid stored preference', () => {
    window.localStorage.setItem('flowcraft.executionInspector.height', '300');
    render(<ExecutionPanel />);
    const handle = screen.getByRole('slider', { name: 'Resize execution inspector' });
    expect(handle.getAttribute('aria-valuenow')).toBe('300');
    fireEvent.pointerDown(handle, { pointerId: 1, clientY: 500 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: -10000 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientY: -10000 });
    expect(Number(handle.getAttribute('aria-valuenow'))).toBe(Number(handle.getAttribute('aria-valuemax')));
  });

  it('falls back from an invalid stored height without dirtying the workflow', () => {
    window.localStorage.setItem('flowcraft.executionInspector.height', 'not-a-number');
    useWorkflowStore.setState({ isDirty: false });
    render(<ExecutionPanel />);
    const handle = screen.getByRole('slider', { name: 'Resize execution inspector' });
    expect(Number(handle.getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(Number(handle.getAttribute('aria-valuemin')));
    expect(Number(handle.getAttribute('aria-valuenow'))).toBeLessThanOrEqual(Number(handle.getAttribute('aria-valuemax')));
    fireEvent.wheel(screen.getByRole('tabpanel'));
    expect(useWorkflowStore.getState().isDirty).toBe(false);
  });

  it('collapses and maximizes without clearing run or active tab', () => {
    useExecutionStore.setState({ activeInspectorTab: 'timeline' });
    render(<ExecutionPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse execution inspector' }));
    expect(useExecutionStore.getState().currentRun?._id).toBe('live_run');
    expect(useExecutionStore.getState().activeInspectorTab).toBe('timeline');
    useExecutionStore.getState().updateNodeStatus('node_1', { status: 'failed' });
    expect(useExecutionStore.getState().currentRun?.stepLogs[0].status).toBe('failed');
    fireEvent.click(screen.getByRole('button', { name: 'Restore execution inspector' }));
    fireEvent.click(screen.getByRole('button', { name: 'Maximize execution inspector' }));
    expect(useUIStore.getState().isExecutionInspectorMaximized).toBe(true);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useUIStore.getState().isExecutionInspectorMaximized).toBe(false);
  });
});
