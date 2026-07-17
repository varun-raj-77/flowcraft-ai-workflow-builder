// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { Edge, Node } from '@xyflow/react';
import type { ExecutionRun, FlowNodeData } from '@/types';
import { useExecutionStore } from '@/stores/executionStore';
import { useUIStore } from '@/stores/uiStore';
import { useWorkflowStore } from '@/stores/workflowStore';

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  joinRun: vi.fn(),
  prepareSocket: vi.fn(),
  runWorkflow: vi.fn(),
}));

vi.mock('./useSaveWorkflow', () => ({ useSaveWorkflow: () => ({ save: mocks.save }) }));
vi.mock('@/features/execution-viewer/hooks/useExecutionSocket', () => ({
  useExecutionSocket: () => ({ joinRun: mocks.joinRun, prepareSocket: mocks.prepareSocket }),
}));
vi.mock('@/lib/api', () => ({
  runWorkflow: mocks.runWorkflow,
  getExecution: vi.fn(),
  getApiErrorMessage: (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback,
}));

import { useRunWorkflow } from './useRunWorkflow';

const nodes: Node<FlowNodeData>[] = [
  { id: 'start', type: 'start', position: { x: 0, y: 0 }, data: { label: 'Start', nodeType: 'start', config: {} } },
  { id: 'end', type: 'end', position: { x: 200, y: 0 }, data: { label: 'End', nodeType: 'end', config: {} } },
];
const edges: Edge[] = [{ id: 'start-end', source: 'start', target: 'end' }];
const runningRun: ExecutionRun = {
  _id: 'run_1', workflowId: 'workflow_1', userId: 'user_1', status: 'running', triggerType: 'manual',
  startedAt: '2026-07-16T12:00:00.000Z', createdAt: '2026-07-16T12:00:00.000Z', updatedAt: '2026-07-16T12:00:00.000Z',
  executionOrder: ['start', 'end'], stepLogs: [],
};

beforeEach(() => {
  vi.useFakeTimers();
  mocks.save.mockReset();
  mocks.joinRun.mockReset();
  mocks.prepareSocket.mockReset();
  mocks.runWorkflow.mockReset();
  useWorkflowStore.setState({
    nodes,
    edges,
    meta: { _id: 'workflow_1', name: 'Workflow', isGeneratedByAI: false },
    isDirty: false,
  });
  useExecutionStore.getState().clearExecution();
  useUIStore.setState({ isExecutionPanelOpen: false });
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('useRunWorkflow socket setup', () => {
  it('does not create or display a pending run when live socket setup fails', async () => {
    mocks.prepareSocket.mockImplementation(() => { throw new Error('Socket.IO is not configured. Set NEXT_PUBLIC_SOCKET_URL or NEXT_PUBLIC_API_URL to a public HTTPS backend origin, then redeploy.'); });
    const { result } = renderHook(() => useRunWorkflow());

    await act(async () => { await result.current.run(); });

    expect(mocks.runWorkflow).not.toHaveBeenCalled();
    expect(useExecutionStore.getState().currentRun).toBeNull();
    expect(useExecutionStore.getState().isRunning).toBe(false);
    expect(useExecutionStore.getState().lastError).toMatch(/NEXT_PUBLIC_SOCKET_URL or NEXT_PUBLIC_API_URL/);
  });

  it('preserves the existing execution flow after successful socket setup', async () => {
    mocks.prepareSocket.mockReturnValue({});
    mocks.runWorkflow.mockResolvedValue(runningRun);
    const { result } = renderHook(() => useRunWorkflow());

    await act(async () => { await result.current.run(); });

    expect(mocks.prepareSocket.mock.invocationCallOrder[0]).toBeLessThan(mocks.runWorkflow.mock.invocationCallOrder[0]);
    expect(mocks.runWorkflow).toHaveBeenCalledWith('workflow_1');
    expect(mocks.joinRun).toHaveBeenCalledWith('run_1');
    expect(useExecutionStore.getState().currentRun?._id).toBe('run_1');
    expect(useExecutionStore.getState().isRunning).toBe(true);
  });
});
