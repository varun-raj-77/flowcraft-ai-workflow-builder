import { describe, expect, it } from 'vitest';
import type { ExecutionRun, StepLog } from '@/types';
import {
  compareExecutionRuns, diagnoseRun, filterHistoryRuns, INTERRUPTED_EXECUTION_ERROR,
} from './executionDebugging';

const step = (id: string, status: StepLog['status'], durationMs?: number, nodeType: StepLog['nodeType'] = 'api_call'): StepLog =>
  ({ nodeId: id, nodeLabel: 'Private secret=abc', nodeType, status, durationMs, error: 'Bearer very-sensitive-token', output: { token: 'private-value' } });
const base: ExecutionRun = {
  _id: 'a', workflowId: 'workflow-1', userId: 'alice', workflowRevision: 3,
  workflowRevisionId: 'revision-3', definitionHash: '1'.repeat(64), status: 'failed',
  triggerType: 'manual', startedAt: '2026-10-18T12:00:00.000Z',
  completedAt: '2026-10-18T12:00:02.000Z', createdAt: '2026-10-18T12:00:00Z',
  updatedAt: '2026-10-18T12:00:02Z',
  error: 'secret=superprivate', executionOrder: ['one', 'two'],
  stepLogs: [step('one', 'success', 400), step('two', 'failed', 1600)],
};
const successful = {
  ...base, _id: 'b', status: 'completed' as const,
  completedAt: '2026-10-18T12:00:01.000Z',
  stepLogs: [step('one', 'success', 300), step('two', 'success', 700)],
};

describe('M12 read-only history and safe failure diagnosis', () => {
  it('filters to matching statuses without modifying stored history', () => {
    const runs = [base, successful];
    expect(filterHistoryRuns(runs, 'failed')).toEqual([base]);
    expect(filterHistoryRuns(runs, 'completed')).toEqual([successful]);
    expect(filterHistoryRuns(runs, 'running')).toEqual([]);
    expect(filterHistoryRuns(runs, 'all')).toEqual(runs);
    expect(filterHistoryRuns(runs, 'all')).not.toBe(runs);
  });

  it('does not claim the reason for an API failure is conclusively known', () => {
    const diagnosed = diagnoseRun(base);
    expect(diagnosed).toMatchObject({ kind: 'api', failedNodeId: 'two' });
    expect(diagnosed.nextAction).toMatch(/Do not blindly resend/);
    expect(JSON.stringify(diagnosed)).not.toMatch(/superprivate|abc|very-sensitive-token|private-value/);
  });

  it('gives fixed, specific, safe guidance for transform and condition failures', () => {
    for (const [type, expected] of [['transform', 'transform'], ['condition', 'condition']] as const) {
      const result = diagnoseRun({ ...base, stepLogs: [step('broken', 'failed', 0, type)] });
      expect(result.kind).toBe(expected);
      expect(result.failedNodeId).toBe('broken');
      expect(JSON.stringify(result)).not.toContain('Bearer');
    }
  });

  it('makes interrupted lease failures explicit without declaring external side effects absent', () => {
    const result = diagnoseRun({ ...base, error: INTERRUPTED_EXECUTION_ERROR });
    expect(result.kind).toBe('interrupted');
    expect(result.description).toMatch(/might already have succeeded/);
  });

  it('keeps active, completed, and cancelled runs distinct', () => {
    expect(diagnoseRun({ ...base, status: 'running' }).failedNodeId).toBeNull();
    expect(diagnoseRun(successful).kind).toBe('success');
    expect(diagnoseRun({ ...base, status: 'cancelled' }).title).toMatch(/cancelled/i);
    expect(diagnoseRun({ ...base, stepLogs: [] }).kind).toBe('other');
  });

  it('compares step status and timing only when immutable pinned revisions match', () => {
    const report = compareExecutionRuns(base, successful);
    expect(report.comparableSteps).toBe(true);
    expect(report.statusChanged).toBe(true);
    expect(report.durationDifferenceMs).toBe(-1000);
    expect(report.successCountDifference).toBe(1);
    expect(report.steps.map(s => ({ id: s.nodeId, before: s.before, after: s.after, duration: s.afterDurationMs })))
      .toEqual([{ id: 'one', before: 'success', after: 'success', duration: 300 }, { id: 'two', before: 'failed', after: 'success', duration: 700 }]);
    const text = JSON.stringify(report);
    expect(text).not.toMatch(/superprivate|secret|private-value|very-sensitive-token|Private|abc|alice/);
  });

  it('refuses step alignment when revision ID, number or hash changes, or either run is legacy', () => {
    for (const different of [
      { workflowRevision: 4 },
      { workflowRevisionId: 'revision-4' },
      { definitionHash: '2'.repeat(64) },
      { workflowRevisionId: undefined },
      { definitionHash: undefined },
    ]) {
      const result = compareExecutionRuns(base, { ...successful, ...different });
      expect(result.comparableSteps).toBe(false);
      expect(result.steps).toEqual([]);
      expect(result.note).toMatch(/do not share a verified identical pinned revision/i);
    }
  });

  it('rejects cross-workflow comparisons even if node IDs appear to match', () => {
    expect(() => compareExecutionRuns(base, { ...successful, workflowId: 'other-tenant' })).toThrow(/different workflows/);
  });

  it('never invents terminal duration deltas for in-flight runs or invalid timestamps', () => {
    expect(compareExecutionRuns(base, { ...successful, status: 'running' }).durationDifferenceMs).toBeNull();
    expect(compareExecutionRuns({ ...base, startedAt: 'invalid' }, successful).durationDifferenceMs).toBeNull();
    expect(compareExecutionRuns(base, { ...successful, completedAt: '2026-10-18T11:00:00Z' }).durationDifferenceMs).toBeNull();
  });

  it('bounds metadata comparison to the first 100 nodes and marks missing nodes', () => {
    const longer = {
      ...successful,
      stepLogs: Array.from({ length: 140 }, (_, i) => step('node-' + i, 'success', i)),
    };
    const result = compareExecutionRuns(base, longer);
    expect(result.comparableSteps).toBe(true);
    expect(result.limited).toBe(true);
    expect(result.steps).toHaveLength(100);
    expect(result.steps.find(s => s.nodeId === 'one')).toMatchObject({ before: 'success', after: 'missing' });
  });
});
