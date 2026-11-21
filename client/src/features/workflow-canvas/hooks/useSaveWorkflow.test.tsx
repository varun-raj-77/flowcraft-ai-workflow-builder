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
  currentRevision: 1,
  currentRevisionId: 'revision-1',
  definitionHash: 'a'.repeat(64),
  createdAt: '2026-07-23T00:00:00.000Z',
  updatedAt: '2026-07-23T00:00:00.000Z',
};

beforeEach(() => {
  vi.useFakeTimers();
  mocks.replace.mockReset();
  mocks.updateWorkflow.mockReset().mockResolvedValue(savedWorkflow);
  mocks.createWorkflow.mockReset().mockResolvedValue(savedWorkflow);
  useWorkflowStore.getState().clearWorkflow();
  useWorkflowStore.setState({
    nodes: [],
    edges: [],
    meta: {
      _id: 'workflow-1',
      name: 'Workflow',
      isGeneratedByAI: false,
      currentRevision: 1,
      currentRevisionId: 'revision-1',
      definitionHash: 'a'.repeat(64),
    },
    isDirty: true,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('useSaveWorkflow', () => {
  it('creates a new record after replacing an old workflow with a new AI draft', async () => {
    useWorkflowStore.getState().setWorkflow(savedWorkflow);
    const metadata = {
      originalPrompt: 'Count posts', generatedAt: '2026-01-01T00:00:00.000Z',
      capabilityCoverage: { requestedCapabilities: [], implementedCapabilities: [], missingCapabilities: [], unsupportedCapabilities: [], coverage: 1, isComplete: true },
    };
    useWorkflowStore.getState().applyGeneratedWorkflow({ name: 'Count Posts', nodes: [], edges: [], generationMetadata: metadata }, true);
    const { result } = renderHook(() => useSaveWorkflow());
    await act(async () => { await result.current.save(); });
    expect(mocks.createWorkflow).toHaveBeenCalledTimes(1);
    expect(mocks.createWorkflow).toHaveBeenCalledWith(expect.objectContaining({ name: 'Count Posts', generationMetadata: metadata }));
    expect(mocks.updateWorkflow).not.toHaveBeenCalled();
  });

  it('prevents concurrent duplicate saves', async () => {
    const { result } = renderHook(() => useSaveWorkflow());

    await act(async () => {
      await Promise.all([result.current.save(), result.current.save()]);
    });

    expect(mocks.updateWorkflow).toHaveBeenCalledTimes(1);
    expect(mocks.updateWorkflow).toHaveBeenCalledWith('workflow-1', expect.objectContaining({
      expectedRevision: 1,
    }));
  });

  it('cleans up transient status timers on unmount', async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const { result, unmount } = renderHook(() => useSaveWorkflow());

    await act(async () => { await result.current.save(); });
    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalled();
  });

  it('does not replace a different workflow loaded while a save was pending', async () => {
    let finish!: (workflow: Workflow) => void;
    mocks.updateWorkflow.mockReturnValueOnce(new Promise<Workflow>((resolve) => { finish = resolve; }));
    const { result } = renderHook(() => useSaveWorkflow());
    await act(async () => {
      const save = result.current.save();
      useWorkflowStore.getState().setWorkflow({ ...savedWorkflow, _id: 'workflow-2', name: 'Different page' });
      finish({ ...savedWorkflow, currentRevision: 2 });
      await expect(save).resolves.toBe(false);
    });
    expect(useWorkflowStore.getState().meta).toMatchObject({ _id: 'workflow-2', name: 'Different page' });
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('discards an old acknowledgement after a clean reload of the same workflow', async () => {
    useWorkflowStore.getState().setWorkflow(savedWorkflow);
    let finish!: (workflow: Workflow) => void;
    mocks.updateWorkflow.mockReturnValueOnce(new Promise<Workflow>((resolve) => { finish = resolve; }));
    const { result } = renderHook(() => useSaveWorkflow());
    await act(async () => {
      const save = result.current.save();
      useWorkflowStore.getState().setWorkflow({ ...savedWorkflow, currentRevision: 3 });
      finish({ ...savedWorkflow, currentRevision: 2 });
      await expect(save).resolves.toBe(false);
    });
    expect(useWorkflowStore.getState().meta?.currentRevision).toBe(3);
    expect(useWorkflowStore.getState().isDirty).toBe(false);
  });

  it('does not adopt or navigate to a creation acknowledged after the draft was replaced', async () => {
    const store = useWorkflowStore.getState();
    store.clearWorkflow();
    store.addNode('delay', { x: 0, y: 0 });
    let finish!: (workflow: Workflow) => void;
    mocks.createWorkflow.mockReturnValueOnce(new Promise<Workflow>((resolve) => { finish = resolve; }));
    const { result } = renderHook(() => useSaveWorkflow());
    await act(async () => {
      const save = result.current.save();
      store.clearWorkflow();
      store.addNode('transform', { x: 0, y: 0 });
      finish(savedWorkflow);
      await expect(save).resolves.toBe(false);
    });
    expect(mocks.createWorkflow).toHaveBeenCalledTimes(1);
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(useWorkflowStore.getState().meta).toBeNull();
    expect(useWorkflowStore.getState().nodes.map((node) => node.type)).toEqual(['transform']);
    expect(useWorkflowStore.getState().createdWorkflowHandoff).toBeNull();
  });

  it('does not start a second save on the temporary URL before canonical navigation', async () => {
    const originalLocation = window.location.href;
    try {
      window.history.replaceState(null, '', '/editor/new');
      const store = useWorkflowStore.getState();
      store.clearWorkflow();
      store.addNode('delay', { x: 0, y: 0 });
      const { result } = renderHook(() => useSaveWorkflow());
      await act(async () => { await expect(result.current.save()).resolves.toBe(true); });
      act(() => { store.addNode('transform', { x: 0, y: 0 }); });

      await act(async () => { await expect(result.current.save()).resolves.toBe(false); });
      expect(mocks.createWorkflow).toHaveBeenCalledTimes(1);
      expect(mocks.updateWorkflow).not.toHaveBeenCalled();
      expect(mocks.replace.mock.calls).toEqual([['/editor/workflow-1'], ['/editor/workflow-1']]);

      window.history.replaceState(null, '', '/editor/workflow-1');
      act(() => { expect(store.consumeCreatedWorkflowHandoff('workflow-1')).toBe(true); });
      await act(async () => { await expect(result.current.save()).resolves.toBe(true); });
      expect(mocks.updateWorkflow).toHaveBeenCalledWith('workflow-1', expect.objectContaining({ expectedRevision: 1 }));
    } finally {
      window.history.replaceState(null, '', originalLocation);
    }
  });
});
