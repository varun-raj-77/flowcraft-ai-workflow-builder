// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkflowStore } from '@/stores/workflowStore';
import type { Workflow } from '@/types';

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  updateWorkflow: vi.fn(),
  createWorkflow: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock('@/lib/api', () => ({
  updateWorkflow: mocks.updateWorkflow,
  createWorkflow: mocks.createWorkflow,
}));

import { useSaveWorkflow } from './useSaveWorkflow';

const savedWorkflow: Workflow = {
  _id: 'workflow-1',
  userId: 'user-1',
  name: 'Workflow',
  nodes: [],
  edges: [],
  isGeneratedByAI: false,
  createdAt: '2026-07-23T00:00:00.000Z',
  updatedAt: '2026-07-23T00:00:00.000Z',
};

beforeEach(() => {
  vi.useFakeTimers();
  mocks.replace.mockReset();
  mocks.updateWorkflow.mockReset().mockResolvedValue(savedWorkflow);
  mocks.createWorkflow.mockReset().mockResolvedValue(savedWorkflow);
  useWorkflowStore.setState({
    nodes: [],
    edges: [],
    meta: { _id: 'workflow-1', name: 'Workflow', isGeneratedByAI: false },
    isDirty: true,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('useSaveWorkflow', () => {
  it('prevents concurrent duplicate saves', async () => {
    const { result } = renderHook(() => useSaveWorkflow());

    await act(async () => {
      await Promise.all([result.current.save(), result.current.save()]);
    });

    expect(mocks.updateWorkflow).toHaveBeenCalledTimes(1);
  });

  it('cleans up transient status timers on unmount', async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const { result, unmount } = renderHook(() => useSaveWorkflow());

    await act(async () => { await result.current.save(); });
    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalled();
  });
});
