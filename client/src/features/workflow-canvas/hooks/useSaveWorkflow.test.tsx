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
});
