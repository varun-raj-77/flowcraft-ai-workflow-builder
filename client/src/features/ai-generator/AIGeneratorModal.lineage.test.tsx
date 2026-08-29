// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workflow, WorkflowAiPromptContext } from '@/types';

const apiMocks = vi.hoisted(() => ({
  getWorkflowAiPromptContext: vi.fn(),
  regenerateWorkflow: vi.fn(),
  generateWorkflow: vi.fn(),
  listWorkflowRevisions: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/api', () => {
  class ApiError extends Error {
    constructor(public status: number, public code: string, message: string) {
      super(message);
    }
  }
  return {
    ...apiMocks,
    ApiError,
    getApiErrorMessage: (error: unknown, fallback: string) => error instanceof ApiError ? error.message : fallback,
  };
});

import { useRevisionComparisonStore } from '@/stores/revisionComparisonStore';
import { useRevisionHistoryStore } from '@/stores/revisionHistoryStore';
import { useUIStore } from '@/stores/uiStore';
import { useWorkflowStore } from '@/stores/workflowStore';
import { AIGeneratorModal } from './AIGeneratorModal';

function workflow(id: string, revision: number, prompt?: string): Workflow {
  return {
    _id: id,
    userId: 'user-1',
    name: 'Lineage workflow',
    nodes: [
      { id: 'start', type: 'start', label: 'Start', position: { x: 0, y: 0 }, config: {} },
      { id: 'end', type: 'end', label: 'End', position: { x: 200, y: 0 }, config: {} },
    ],
    edges: [{ id: 'start-end', source: 'start', target: 'end' }],
    isGeneratedByAI: Boolean(prompt),
    ...(prompt ? {
      generationMetadata: {
        originalPrompt: prompt,
        generatedAt: '2026-08-28T00:00:00.000Z',
        provider: 'mock',
        model: 'mock-model',
      },
    } : {}),
    currentRevision: revision,
    currentRevisionId: `${id}-revision-${revision}`,
    definitionHash: String(revision).repeat(64).slice(0, 64),
    createdAt: '2026-08-28T00:00:00.000Z',
    updatedAt: '2026-08-28T00:00:00.000Z',
  };
}

function available(prompt: string, currentRevision = 1): WorkflowAiPromptContext {
  return {
    status: 'available',
    prompt,
    promptRevision: currentRevision,
    currentRevision,
    relationship: 'direct',
    provider: 'mock',
    model: 'mock-model',
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

beforeEach(() => {
  useWorkflowStore.getState().clearWorkflow();
  useRevisionHistoryStore.getState().reset();
  useRevisionComparisonStore.getState().reset();
  useUIStore.setState({ isAIModalOpen: true });
  apiMocks.listWorkflowRevisions.mockResolvedValue({ revisions: [], nextBeforeRevision: null });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AIGeneratorModal current-workflow prompt lineage', () => {
  it.each([
    ['direct', 'Prompt P1', 1],
    ['inherited', 'Inherited prompt', 4],
  ] as const)('prefills an authoritative %s prompt without mutating editor state', async (relationship, prompt, revision) => {
    const current = workflow('workflow-1', revision, prompt);
    useWorkflowStore.getState().setWorkflow(current);
    apiMocks.getWorkflowAiPromptContext.mockResolvedValue({
      ...available(prompt, revision),
      promptRevision: relationship === 'direct' ? revision : 1,
      relationship,
    });
    const before = useWorkflowStore.getState();

    render(<AIGeneratorModal mode="current-workflow" />);

    expect(await screen.findByDisplayValue(prompt)).toBeTruthy();
    expect(screen.getByText('Based on the prompt used to generate this workflow.')).toBeTruthy();
    expect(useWorkflowStore.getState().nodes).toEqual(before.nodes);
    expect(useWorkflowStore.getState().meta).toEqual(before.meta);
    expect(useWorkflowStore.getState().isDirty).toBe(false);
  });

  it('shows an honest empty state for a manual-only workflow', async () => {
    useWorkflowStore.getState().setWorkflow(workflow('manual-workflow', 3));
    apiMocks.getWorkflowAiPromptContext.mockResolvedValue({ status: 'none', currentRevision: 3 });

    render(<AIGeneratorModal mode="current-workflow" />);

    await waitFor(() => expect((screen.getByLabelText('Workflow prompt') as HTMLTextAreaElement).disabled).toBe(false));
    expect((screen.getByLabelText('Workflow prompt') as HTMLTextAreaElement).value).toBe('');
    expect(screen.queryByText('Based on the prompt used to generate this workflow.')).toBeNull();
    expect(screen.queryByText(/previous prompt|saved prompt/i)).toBeNull();
  });

  it('keeps context failures distinct and retryable', async () => {
    useWorkflowStore.getState().setWorkflow(workflow('workflow-1', 1, 'Prompt P1'));
    apiMocks.getWorkflowAiPromptContext
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(available('Prompt P1'));

    render(<AIGeneratorModal mode="current-workflow" />);

    expect(await screen.findByText('AI prompt history could not be loaded.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByDisplayValue('Prompt P1')).toBeTruthy();
    expect(apiMocks.getWorkflowAiPromptContext).toHaveBeenCalledTimes(2);
  });

  it('ignores a stale prompt response after switching workflows', async () => {
    const first = deferred<WorkflowAiPromptContext>();
    const second = deferred<WorkflowAiPromptContext>();
    apiMocks.getWorkflowAiPromptContext.mockImplementation((id: string) => (
      id === 'workflow-a' ? first.promise : second.promise
    ));
    useWorkflowStore.getState().setWorkflow(workflow('workflow-a', 1, 'Prompt A'));
    render(<AIGeneratorModal mode="current-workflow" />);

    act(() => useWorkflowStore.getState().setWorkflow(workflow('workflow-b', 1, 'Prompt B')));
    await act(async () => first.resolve(available('Prompt A')));
    expect(screen.queryByDisplayValue('Prompt A')).toBeNull();
    await act(async () => second.resolve(available('Prompt B')));
    expect(await screen.findByDisplayValue('Prompt B')).toBeTruthy();
  });

  it('does not mutate workflow state when the prompt is edited and the modal is closed', async () => {
    useWorkflowStore.getState().setWorkflow(workflow('workflow-1', 1, 'Prompt P1'));
    apiMocks.getWorkflowAiPromptContext.mockResolvedValue(available('Prompt P1'));
    render(<AIGeneratorModal mode="current-workflow" />);
    const input = await screen.findByDisplayValue('Prompt P1');
    const before = useWorkflowStore.getState();

    fireEvent.change(input, { target: { value: 'Unsaved prompt edit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(useWorkflowStore.getState().nodes).toEqual(before.nodes);
    expect(useWorkflowStore.getState().meta).toEqual(before.meta);
    expect(useWorkflowStore.getState().isDirty).toBe(false);
    expect(apiMocks.regenerateWorkflow).not.toHaveBeenCalled();
  });

  it('persists P2 as a new revision, resets editor history cleanly, and reloads P2 on reopen', async () => {
    const v1 = workflow('workflow-1', 1, 'Prompt P1');
    const v2 = workflow('workflow-1', 2, 'Prompt P2');
    useWorkflowStore.getState().setWorkflow(v1);
    apiMocks.getWorkflowAiPromptContext
      .mockResolvedValueOnce(available('Prompt P1'))
      .mockResolvedValueOnce(available('Prompt P2', 2));
    apiMocks.regenerateWorkflow.mockResolvedValue(v2);
    render(<AIGeneratorModal mode="current-workflow" />);
    const input = await screen.findByDisplayValue('Prompt P1');

    fireEvent.change(input, { target: { value: 'Prompt P2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate Workflow' }));

    await waitFor(() => expect(useUIStore.getState().isAIModalOpen).toBe(false));
    expect(apiMocks.regenerateWorkflow).toHaveBeenCalledWith('workflow-1', {
      prompt: 'Prompt P2',
      expectedRevision: 1,
    });
    expect(useWorkflowStore.getState()).toMatchObject({
      isDirty: false,
      undoStack: [],
      redoStack: [],
      meta: { _id: 'workflow-1', currentRevision: 2, generationMetadata: { originalPrompt: 'Prompt P2' } },
    });

    act(() => useUIStore.getState().openAIModal());
    expect(await screen.findByDisplayValue('Prompt P2')).toBeTruthy();
    expect(apiMocks.getWorkflowAiPromptContext).toHaveBeenCalledTimes(2);
  });
});
