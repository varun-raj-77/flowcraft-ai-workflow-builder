import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertWorkflowRevisionForAiGeneration: vi.fn(),
  createAiGeneratedWorkflowRevision: vi.fn(),
  generateWorkflow: vi.fn(),
}));

vi.mock('./ai.service', () => ({ generateWorkflow: mocks.generateWorkflow }));
vi.mock('./workflow.service', () => ({
  assertWorkflowRevisionForAiGeneration: mocks.assertWorkflowRevisionForAiGeneration,
  createAiGeneratedWorkflowRevision: mocks.createAiGeneratedWorkflowRevision,
}));

import { AppError } from '../middleware/errorHandler.middleware';
import { regenerateWorkflow } from './aiWorkflow.service';

const generated = {
  name: 'Regenerated workflow',
  nodes: [
    { id: 'start', type: 'start', label: 'Start', position: { x: 0, y: 0 }, config: {} },
    { id: 'end', type: 'end', label: 'End', position: { x: 200, y: 0 }, config: {} },
  ],
  edges: [{ id: 'start-end', source: 'start', target: 'end' }],
  generationMetadata: {
    originalPrompt: 'Prompt P2',
    generatedAt: '2026-08-28T00:00:00.000Z',
    provider: 'anthropic',
    model: 'claude',
    capabilityCoverage: {
      requestedCapabilities: ['output' as const],
      implementedCapabilities: ['output' as const],
      missingCapabilities: [],
      unsupportedCapabilities: [],
      coverage: 1,
      isComplete: true,
    },
  },
};

beforeEach(() => {
  mocks.assertWorkflowRevisionForAiGeneration.mockResolvedValue(undefined);
  mocks.generateWorkflow.mockResolvedValue(generated);
  mocks.createAiGeneratedWorkflowRevision.mockResolvedValue({
    _id: 'workflow-1',
    currentRevision: 2,
    generationMetadata: generated.generationMetadata,
  });
});

describe('AI workflow regeneration orchestration', () => {
  it('generates with the edited prompt and persists one explicit revision from the expected version', async () => {
    await regenerateWorkflow('workflow-1', 'user-1', { prompt: 'Prompt P2', expectedRevision: 1 });

    expect(mocks.assertWorkflowRevisionForAiGeneration).toHaveBeenCalledWith('workflow-1', 'user-1', 1);
    expect(mocks.generateWorkflow).toHaveBeenCalledWith('Prompt P2');
    expect(mocks.createAiGeneratedWorkflowRevision).toHaveBeenCalledWith(
      'workflow-1',
      'user-1',
      1,
      generated,
    );
  });

  it('does not call the provider or persistence when ownership or expected revision preflight fails', async () => {
    mocks.assertWorkflowRevisionForAiGeneration.mockRejectedValue(
      new AppError(409, 'WORKFLOW_REVISION_CONFLICT', 'Stale revision'),
    );

    await expect(regenerateWorkflow('workflow-1', 'user-1', { prompt: 'Prompt P2', expectedRevision: 1 }))
      .rejects.toMatchObject({ code: 'WORKFLOW_REVISION_CONFLICT' });
    expect(mocks.generateWorkflow).not.toHaveBeenCalled();
    expect(mocks.createAiGeneratedWorkflowRevision).not.toHaveBeenCalled();
  });

  it('leaves revision history untouched when provider generation fails', async () => {
    mocks.generateWorkflow.mockRejectedValue(new AppError(503, 'AI_UNAVAILABLE', 'Try again'));

    await expect(regenerateWorkflow('workflow-1', 'user-1', { prompt: 'Prompt P2', expectedRevision: 1 }))
      .rejects.toMatchObject({ code: 'AI_UNAVAILABLE' });
    expect(mocks.createAiGeneratedWorkflowRevision).not.toHaveBeenCalled();
  });

  it('does not persist incomplete capability coverage', async () => {
    mocks.generateWorkflow.mockResolvedValue({
      ...generated,
      generationMetadata: {
        ...generated.generationMetadata,
        capabilityCoverage: {
          ...generated.generationMetadata.capabilityCoverage,
          implementedCapabilities: [],
          missingCapabilities: ['output' as const],
          coverage: 0,
          isComplete: false,
        },
      },
    });

    await expect(regenerateWorkflow('workflow-1', 'user-1', { prompt: 'Prompt P2', expectedRevision: 1 }))
      .rejects.toMatchObject({ code: 'AI_CAPABILITY_INCOMPLETE' });
    expect(mocks.createAiGeneratedWorkflowRevision).not.toHaveBeenCalled();
  });

  it('surfaces a post-provider concurrency conflict without retrying or creating another event', async () => {
    mocks.createAiGeneratedWorkflowRevision.mockRejectedValue(
      new AppError(409, 'WORKFLOW_REVISION_CONFLICT', 'Workflow changed while AI generation was completing'),
    );

    await expect(regenerateWorkflow('workflow-1', 'user-1', { prompt: 'Prompt P2', expectedRevision: 1 }))
      .rejects.toMatchObject({ code: 'WORKFLOW_REVISION_CONFLICT' });
    expect(mocks.generateWorkflow).toHaveBeenCalledTimes(1);
    expect(mocks.createAiGeneratedWorkflowRevision).toHaveBeenCalledTimes(1);
  });
});
