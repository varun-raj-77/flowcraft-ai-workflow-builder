import { afterEach, describe, expect, it, vi } from 'vitest';

const originalModel = process.env.ANTHROPIC_MODEL;

afterEach(() => {
  if (originalModel === undefined) delete process.env.ANTHROPIC_MODEL;
  else process.env.ANTHROPIC_MODEL = originalModel;
  vi.resetModules();
});

describe('Anthropic model configuration', () => {
  it('uses the configured model when ANTHROPIC_MODEL is set', async () => {
    process.env.ANTHROPIC_MODEL = 'workspace-selected-model';
    const { env } = await import('./environment');
    expect(env.ANTHROPIC_MODEL).toBe('workspace-selected-model');
  });

  it('uses the verified Haiku default when ANTHROPIC_MODEL is absent', async () => {
    delete process.env.ANTHROPIC_MODEL;
    const { DEFAULT_ANTHROPIC_MODEL, env } = await import('./environment');
    expect(env.ANTHROPIC_MODEL).toBe(DEFAULT_ANTHROPIC_MODEL);
  });
});
