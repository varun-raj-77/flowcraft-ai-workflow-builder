import type { WorkflowSummary } from '@/types';

export const WORKFLOW_RUN_FILTERS = [
  { value: 'all', label: 'Any status' },
  { value: 'running', label: 'Running' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'never', label: 'Never run' },
  { value: 'unknown', label: 'Status unavailable' },
] as const;

export type WorkflowRunFilter = typeof WORKFLOW_RUN_FILTERS[number]['value'];

export function filterWorkflows(
  workflows: readonly WorkflowSummary[],
  search: string,
  runFilter: WorkflowRunFilter,
): readonly WorkflowSummary[] {
  const query = search.trim().toLowerCase();
  if (!query && runFilter === 'all') return workflows;

  return workflows.filter((workflow) => {
    const status = workflow.lastExecutionStatus === null
      ? 'never'
      : workflow.lastExecutionStatus ?? 'unknown';
    if (runFilter !== 'all' && status !== runFilter) return false;
    return !query ||
      workflow.name.toLowerCase().includes(query) ||
      Boolean(workflow.description?.toLowerCase().includes(query));
  });
}
