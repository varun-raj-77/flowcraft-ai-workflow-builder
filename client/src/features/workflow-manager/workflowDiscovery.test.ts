import { describe, expect, it } from 'vitest';
import type { WorkflowSummary } from '@/types';
import { filterWorkflows } from './workflowDiscovery';

function workflow(
  id: string,
  name: string,
  rest: Partial<WorkflowSummary> = {},
): WorkflowSummary {
  return {
    _id: id,
    userId: 'owner',
    name,
    isGeneratedByAI: false,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
    ...rest,
  };
}

const workflows = [
  workflow('1', 'Release digest', { lastExecutionStatus: 'completed' }),
  workflow('2', 'Invoice report', { description: 'Release quality checks', lastExecutionStatus: 'failed' }),
  workflow('3', 'Release draft', { lastExecutionStatus: null }),
  workflow('4', 'Imported release', {
    isGeneratedByAI: true,
    generationMetadata: { originalPrompt: 'private draft text', generatedAt: '2026-08-02T00:00:00.000Z' },
  }),
];

describe('filterWorkflows', () => {
  const ids = (results: readonly WorkflowSummary[]) => results.map((result) => result._id);

  it('preserves the existing array and order when inactive, including whitespace-only input', () => {
    expect(filterWorkflows(workflows, '   ', 'all')).toBe(workflows);
    expect(ids(filterWorkflows(workflows, '  rELeASE  ', 'all'))).toEqual(['1', '2', '3', '4']);
  });

  it('intersects the description or name match with last-run status', () => {
    expect(ids(filterWorkflows(workflows, 'quality', 'failed'))).toEqual(['2']);
    expect(filterWorkflows(workflows, 'quality', 'completed')).toEqual([]);
  });

  it('separates confirmed never-run from unavailable status on older responses', () => {
    expect(ids(filterWorkflows(workflows, 'release', 'never'))).toEqual(['3']);
    expect(ids(filterWorkflows(workflows, 'release', 'unknown'))).toEqual(['4']);
  });

  it('does not match AI prompts or other metadata', () => {
    expect(filterWorkflows(workflows, 'private draft text', 'all')).toEqual([]);
  });
});
