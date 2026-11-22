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
  leaveCurrentRoom: vi.fn(),
  prepareSocket: vi.fn(),
  runWorkflow: vi.fn(),
}));

vi.mock('@/features/execution-viewer/hooks/useExecutionSocket', () => ({
  useExecutionSocket: () => ({ joinRun: mocks.joinRun, leaveCurrentRoom: mocks.leaveCurrentRoom, prepareSocket: mocks.prepareSocket }),
}));
vi.mock('@/lib/api', () => ({
  runWorkflow: mocks.runWorkflow,
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
  mocks.leaveCurrentRoom.mockReset();
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
    const { result } = renderHook(() => useRunWorkflow(mocks.save));

    await act(async () => { await result.current.run(); });

    expect(mocks.runWorkflow).not.toHaveBeenCalled();
    expect(useExecutionStore.getState().currentRun).toBeNull();
    expect(useExecutionStore.getState().isRunning).toBe(false);
    expect(useExecutionStore.getState().lastError).toMatch(/NEXT_PUBLIC_SOCKET_URL or NEXT_PUBLIC_API_URL/);
  });

  it('preserves the existing execution flow after successful socket setup', async () => {
    mocks.prepareSocket.mockReturnValue({});
    mocks.runWorkflow.mockResolvedValue(runningRun);
    const { result } = renderHook(() => useRunWorkflow(mocks.save));

    await act(async () => { await result.current.run(); });

    expect(mocks.prepareSocket.mock.invocationCallOrder[0]).toBeLessThan(mocks.runWorkflow.mock.invocationCallOrder[0]);
    expect(mocks.runWorkflow).toHaveBeenCalledWith('workflow_1');
    expect(mocks.joinRun).toHaveBeenCalledWith('run_1');
    expect(useExecutionStore.getState().currentRun?._id).toBe('run_1');
    expect(useExecutionStore.getState().isRunning).toBe(true);
  });

  it('does not run an older saved revision if a newer draft remains unsaved', async () => {
    useWorkflowStore.setState({ isDirty: true });
    mocks.save.mockResolvedValue(true);
    const { result } = renderHook(() => useRunWorkflow(mocks.save));
    await act(async () => { await result.current.run(); });
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.prepareSocket).not.toHaveBeenCalled();
    expect(mocks.runWorkflow).not.toHaveBeenCalled();
    expect(useExecutionStore.getState().lastError).toMatch(/changed while saving/i);
  });

  it('does not run when autosave acknowledgement belongs to an earlier editor instance', async () => {
    useWorkflowStore.setState({ isDirty: true });
    let acknowledge!: (applied: boolean) => void;
    mocks.save.mockReturnValue(new Promise<boolean>((resolve) => { acknowledge = resolve; }));
    const { result } = renderHook(() => useRunWorkflow(mocks.save));
    await act(async () => {
      const run = result.current.run();
      useWorkflowStore.setState({
        meta: { _id: 'workflow_1', name: 'Reloaded workflow', isGeneratedByAI: false },
        isDirty: false,
      });
      acknowledge(false);
      await run;
    });
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.prepareSocket).not.toHaveBeenCalled();
    expect(mocks.runWorkflow).not.toHaveBeenCalled();
  });

  it('cleans up the active execution room when the editor unmounts', async () => {
    mocks.prepareSocket.mockReturnValue({});
    mocks.runWorkflow.mockResolvedValue(runningRun);
    const { result, unmount } = renderHook(() => useRunWorkflow(mocks.save));

    await act(async () => { await result.current.run(); });
    expect(mocks.joinRun).toHaveBeenCalledWith('run_1');
    unmount();
    expect(mocks.leaveCurrentRoom).toHaveBeenCalledTimes(1);
  });
});


describe('useRunWorkflow dispatch guard', () => {
  it('sends one start request even when Run is invoked twice before the first response', async () => {
    mocks.prepareSocket.mockReturnValue({});
    let complete!: (run: ExecutionRun) => void;
    mocks.runWorkflow.mockReturnValue(new Promise<ExecutionRun>((resolve) => { complete = resolve; }));
    const { result } = renderHook(() => useRunWorkflow(mocks.save));
    let first!: Promise<void>;
    let second!: Promise<void>;

    act(() => {
      first = result.current.run();
      second = result.current.run();
    });
    await second;
    expect(result.current.isStarting).toBe(true);
    expect(mocks.runWorkflow).toHaveBeenCalledTimes(1);

    await act(async () => {
      complete(runningRun);
      await first;
      await result.current.run();
    });
    expect(result.current.isStarting).toBe(false);
    expect(result.current.isRunning).toBe(true);
    expect(mocks.runWorkflow).toHaveBeenCalledTimes(1);
  });

  it('also guards the auto-save gap and unlocks Run if auto-save does not finish', async () => {
    useWorkflowStore.setState({ isDirty: true });
    let acknowledge!: (applied: boolean) => void;
    mocks.save.mockReturnValueOnce(new Promise<boolean>((resolve) => { acknowledge = resolve; }));
    const { result } = renderHook(() => useRunWorkflow(mocks.save));
    let first!: Promise<void>;
    let second!: Promise<void>;

    act(() => {
      first = result.current.run();
      second = result.current.run();
    });
    await second;
    expect(result.current.isStarting).toBe(true);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.runWorkflow).not.toHaveBeenCalled();

    await act(async () => { acknowledge(false); await first; });
    expect(result.current.isStarting).toBe(false);

    mocks.save.mockImplementationOnce(async () => {
      useWorkflowStore.setState({ isDirty: false });
      return true;
    });
    mocks.runWorkflow.mockResolvedValueOnce(runningRun);
    await act(async () => { await result.current.run(); });
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(mocks.runWorkflow).toHaveBeenCalledTimes(1);
    expect(result.current.isStarting).toBe(false);
  });
});


describe('useRunWorkflow route ownership', () => {
  it.each(['success', 'failure'] as const)(
    'a stale %s does not replace the next editor’s pending dispatch',
    async (outcome) => {
      mocks.prepareSocket.mockReturnValue({});
      let completeOld!: (run: ExecutionRun) => void;
      let rejectOld!: (reason: Error) => void;
      let completeNew!: (run: ExecutionRun) => void;
      mocks.runWorkflow
        .mockReturnValueOnce(new Promise<ExecutionRun>((resolve, reject) => {
          completeOld = resolve;
          rejectOld = reject;
        }))
        .mockReturnValueOnce(new Promise<ExecutionRun>((resolve) => { completeNew = resolve; }));
      const { result } = renderHook(() => useRunWorkflow(mocks.save));
      let oldStart!: Promise<void>;
      let newStart!: Promise<void>;
      act(() => {
        oldStart = result.current.run();
        useWorkflowStore.setState({ meta: { _id: 'workflow_2', name: 'Other workflow', isGeneratedByAI: false } });
        useExecutionStore.getState().clearExecution();
        newStart = result.current.run();
      });

      await act(async () => {
        if (outcome === 'success') completeOld(runningRun);
        else rejectOld(new Error('Old request failed.'));
        await oldStart;
      });
      expect(result.current.isStarting).toBe(true);
      expect(useExecutionStore.getState().currentRun).toBeNull();
      expect(useExecutionStore.getState().lastError).toBeNull();
      expect(mocks.joinRun).not.toHaveBeenCalled();

      await act(async () => {
        completeNew({ ...runningRun, _id: 'run_2', workflowId: 'workflow_2' });
        await newStart;
      });
      expect(result.current.isStarting).toBe(false);
      expect(useExecutionStore.getState().currentRun?._id).toBe('run_2');
      expect(mocks.joinRun.mock.calls).toEqual([['run_2']]);
    },
  );
});
