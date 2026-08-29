import { describe, expect, it } from 'vitest';
import {
  resolveWorkflowAiPromptLineage,
  type AiLineageRevision,
} from './workflowAiLineage';

function revision(
  number: number,
  source: AiLineageRevision['source'],
  options: {
    parent?: number | null;
    restoredFrom?: number;
    prompt?: string;
    provider?: string;
    model?: string;
  } = {},
): AiLineageRevision {
  return {
    id: `r${number}`,
    revision: number,
    source,
    parentRevisionId: options.parent === null
      ? null
      : `r${options.parent ?? number - 1}`,
    restoredFromRevisionId: options.restoredFrom ? `r${options.restoredFrom}` : undefined,
    generationMetadata: options.prompt !== undefined
      ? {
        originalPrompt: options.prompt,
        provider: options.provider,
        model: options.model,
      }
      : undefined,
  };
}

async function resolve(revisions: AiLineageRevision[], currentRevision: number) {
  const byId = new Map(revisions.map((item) => [item.id, item]));
  return resolveWorkflowAiPromptLineage(
    byId.get(`r${currentRevision}`)!,
    async (id) => byId.get(id) ?? null,
  );
}

describe('current workflow AI prompt lineage', () => {
  it('1: resolves a direct AI revision', async () => {
    await expect(resolve([
      revision(3, 'ai_generated', { parent: 2, prompt: 'Prompt A', provider: 'anthropic', model: 'claude' }),
    ], 3)).resolves.toEqual({
      status: 'available',
      prompt: 'Prompt A',
      promptRevision: 3,
      currentRevision: 3,
      relationship: 'direct',
      provider: 'anthropic',
      model: 'claude',
    });
  });

  it('2: inherits the nearest AI prompt through manual revisions', async () => {
    const result = await resolve([
      revision(3, 'ai_generated', { parent: 2, prompt: 'Prompt A' }),
      revision(4, 'manual', { parent: 3 }),
      revision(5, 'manual', { parent: 4 }),
    ], 5);
    expect(result).toMatchObject({ status: 'available', prompt: 'Prompt A', promptRevision: 3, relationship: 'inherited' });
  });

  it('3: returns none for a manual-only definition', async () => {
    await expect(resolve([
      revision(1, 'manual', { parent: null }),
      revision(2, 'manual', { parent: 1 }),
    ], 2)).resolves.toEqual({ status: 'none', currentRevision: 2 });
  });

  it('4: stops at the newest AI generation event', async () => {
    const result = await resolve([
      revision(2, 'ai_generated', { parent: 1, prompt: 'Prompt A' }),
      revision(3, 'manual', { parent: 2 }),
      revision(4, 'ai_generated', { parent: 3, prompt: 'Prompt B' }),
      revision(5, 'manual', { parent: 4 }),
    ], 5);
    expect(result).toMatchObject({ status: 'available', prompt: 'Prompt B', promptRevision: 4, relationship: 'inherited' });
  });

  it('5: follows restoredFrom before parent for an AI-derived restore', async () => {
    const result = await resolve([
      revision(3, 'ai_generated', { parent: 2, prompt: 'Prompt A' }),
      revision(10, 'manual', { parent: 9 }),
      revision(11, 'restore', { parent: 10, restoredFrom: 3 }),
    ], 11);
    expect(result).toMatchObject({ status: 'available', prompt: 'Prompt A', promptRevision: 3, relationship: 'restored' });
  });

  it('6: a non-AI restored branch returns none even when the restore parent has AI ancestry', async () => {
    const result = await resolve([
      revision(1, 'manual', { parent: null }),
      revision(3, 'ai_generated', { parent: 2, prompt: 'Unrelated prompt' }),
      revision(10, 'manual', { parent: 3 }),
      revision(11, 'restore', { parent: 10, restoredFrom: 1 }),
    ], 11);
    expect(result).toEqual({ status: 'none', currentRevision: 11 });
  });

  it('7: manual edits after an AI-derived restore keep restored lineage', async () => {
    const result = await resolve([
      revision(3, 'ai_generated', { parent: 2, prompt: 'Prompt A' }),
      revision(11, 'restore', { parent: 10, restoredFrom: 3 }),
      revision(12, 'manual', { parent: 11 }),
    ], 12);
    expect(result).toMatchObject({ status: 'available', prompt: 'Prompt A', relationship: 'restored' });
  });

  it('8: corrupt AI provenance is unavailable and never falls through to an older prompt', async () => {
    const result = await resolve([
      revision(2, 'ai_generated', { parent: 1, prompt: 'Older prompt' }),
      revision(3, 'ai_generated', { parent: 2, prompt: '   ' }),
      revision(4, 'manual', { parent: 3 }),
    ], 4);
    expect(result).toMatchObject({ status: 'unavailable', currentRevision: 4 });
    expect(result).not.toHaveProperty('prompt');
  });

  it('follows restore-of-restore definition ancestry through a later manual revision', async () => {
    const result = await resolve([
      revision(2, 'ai_generated', { parent: 1, prompt: 'Prompt P' }),
      revision(5, 'restore', { parent: 4, restoredFrom: 2 }),
      revision(8, 'restore', { parent: 7, restoredFrom: 5 }),
      revision(9, 'manual', { parent: 8 }),
    ], 9);

    expect(result).toMatchObject({
      status: 'available',
      prompt: 'Prompt P',
      promptRevision: 2,
      currentRevision: 9,
      relationship: 'restored',
    });
  });

  it('remains bounded and unavailable for cyclic ancestry', async () => {
    const first = revision(1, 'manual', { parent: 2 });
    const second = revision(2, 'manual', { parent: 1 });

    await expect(resolve([first, second], 2)).resolves.toMatchObject({
      status: 'unavailable',
      currentRevision: 2,
    });
  });

  it('handles long valid manual ancestry and preserves the maximum valid prompt intact', async () => {
    const prompt = 'P'.repeat(2000);
    const revisions = [revision(1, 'ai_generated', { parent: null, prompt })];
    for (let number = 2; number <= 75; number += 1) {
      revisions.push(revision(number, 'manual', { parent: number - 1 }));
    }

    const result = await resolve(revisions, 75);
    expect(result).toMatchObject({ status: 'available', prompt, promptRevision: 1 });
  });
});
