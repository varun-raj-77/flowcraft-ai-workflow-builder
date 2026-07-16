import { describe, expect, it } from 'vitest';
import type { ExecutionRun } from '@/types';
import {
  buildTimelineSteps,
  getDurationBarPercent,
  getPayloadDiff,
  getPayloadSize,
  getRunSummary,
  redactInspectionValue,
} from './executionInspector';

const run: ExecutionRun = {
  _id: 'run_1', workflowId: 'workflow_1', userId: 'user_1', status: 'failed',
  triggerType: 'manual', startedAt: '2026-07-15T10:00:00.000Z', completedAt: '2026-07-15T10:00:05.000Z',
  createdAt: '2026-07-15T10:00:00.000Z', updatedAt: '2026-07-15T10:00:05.000Z',
  executionOrder: ['start', 'fetch', 'log'],
  stepLogs: [
    { nodeId: 'log', nodeType: 'output', nodeLabel: 'Log failure', status: 'skipped' },
    { nodeId: 'fetch', nodeType: 'api_call', nodeLabel: 'Fetch data', status: 'failed', startedAt: '2026-07-15T10:00:01.000Z', completedAt: '2026-07-15T10:00:04.000Z', durationMs: 3000, error: 'Request failed' },
    { nodeId: 'start', nodeType: 'start', nodeLabel: 'Start', status: 'success', startedAt: '2026-07-15T10:00:00.000Z', completedAt: '2026-07-15T10:00:00.000Z', durationMs: 0 },
  ],
};

describe('execution inspector helpers', () => {
  it('orders timeline entries by timestamps with execution order as a fallback', () => {
    expect(buildTimelineSteps(run).map((step) => step.log.nodeId)).toEqual(['start', 'fetch', 'log']);
  });

  it('normalizes duration bars and safely handles zero or missing durations', () => {
    expect(getDurationBarPercent(3000, 3000)).toBe(100);
    expect(getDurationBarPercent(1500, 3000)).toBe(50);
    expect(getDurationBarPercent(0, 3000)).toBe(0);
    expect(getDurationBarPercent(undefined, 3000)).toBe(0);
    expect(getDurationBarPercent(100, 0)).toBe(0);
  });

  it('derives failed and skipped counts without adding backend summary fields', () => {
    expect(getRunSummary(run).completedSteps).toBe(3);
    expect(getRunSummary(run).failedSteps).toBe(1);
    expect(getRunSummary(run).skippedSteps).toBe(1);
  });

  it('redacts secret-shaped inspection values before display', () => {
    expect(redactInspectionValue({ headers: { Authorization: 'Bearer secret-token' }, token: 'private' })).toEqual({
      headers: { Authorization: '[REDACTED]' },
      token: '[REDACTED]',
    });
  });

  it('calculates a shallow bounded payload diff without walking large nested values', () => {
    expect(getPayloadDiff({ users: [{ id: 1 }], total: 1, removed: true }, { vipUsers: [{ id: 1 }], total: 2 })).toEqual({
      added: ['vipUsers'],
      removed: ['users', 'removed'],
      changed: ['total'],
    });
  });

  it('sizes redacted payloads without retaining a duplicate in store state', () => {
    expect(getPayloadSize({ token: 'private' })).toBeGreaterThan(0);
  });
});
