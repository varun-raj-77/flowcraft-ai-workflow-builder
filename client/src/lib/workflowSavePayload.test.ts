import { describe, expect, it } from 'vitest';
import { hasCompleteGenerationMetadata, normalizeGenerationMetadata, withNormalizedGenerationMetadata } from './workflowSavePayload';

const completeMetadata = {
  originalPrompt: 'Fetch active users',
  generatedAt: '2026-07-16T12:00:00.000Z',
  provider: 'anthropic',
  model: 'claude-haiku-4-5-20251001',
  capabilityCoverage: {
    requestedCapabilities: ['fetch'],
    implementedCapabilities: ['fetch'],
    missingCapabilities: [],
    unsupportedCapabilities: [],
    coverage: 1,
    isComplete: true,
  },
};

describe('workflow save payload normalization', () => {
  it('omits generation metadata for manual workflows', () => {
    const payload = withNormalizedGenerationMetadata({ name: 'Manual workflow' }, undefined);

    expect(payload).not.toHaveProperty('generationMetadata');
  });

  it('preserves complete metadata for valid AI-generated workflows', () => {
    const payload = withNormalizedGenerationMetadata({ name: 'Generated workflow' }, completeMetadata);

    expect(payload.generationMetadata).toEqual(completeMetadata);
  });

  it.each([{}, { originalPrompt: undefined }, { originalPrompt: null }, { originalPrompt: '' }, { originalPrompt: 'Prompt' }])(
    'omits incomplete metadata before it can reach the API: %o',
    (metadata) => {
      const payload = withNormalizedGenerationMetadata({ name: 'Workflow' }, metadata);

      expect(payload).not.toHaveProperty('generationMetadata');
    },
  );

  it('keeps older generated workflows saveable when no metadata is available', () => {
    expect(normalizeGenerationMetadata(undefined)).toBeUndefined();
    expect(hasCompleteGenerationMetadata(undefined)).toBe(false);
  });

  it('rejects incomplete generated results before they can replace the graph', () => {
    expect(hasCompleteGenerationMetadata({ originalPrompt: 'Prompt', generatedAt: '2026-07-16T12:00:00.000Z' })).toBe(false);
    expect(hasCompleteGenerationMetadata(completeMetadata)).toBe(true);
  });
});
