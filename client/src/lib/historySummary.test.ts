import { describe, expect, it } from 'vitest';
import type { ExecutionRun } from '@/types';
import { toHistorySummaryRun } from './historySummary';

const privateRun: ExecutionRun = {
  _id: 'run-1',
  workflowId: 'workflow-1',
  userId: 'user-1',
  retryOfRunId: 'source-run',
  workflowRevisionId: 'rev-2',
  workflowRevision: 2,
  definitionHash: 'a'.repeat(64),
  status: 'failed',
  startedAt: '2026-10-20T10:00:00.000Z',
  completedAt: '2026-10-20T10:00:01.000Z',
  triggerType: 'manual',
  error: 'run-error-CANARY',
  stepLogs: [{
    nodeId: 'api-node', nodeType: 'api_call', nodeLabel: 'Call API',
    status: 'failed', durationMs: 500,
    startedAt: '2026-10-20T10:00:00.000Z', completedAt: '2026-10-20T10:00:01.000Z',
    input: { token: 'input-CANARY' }, output: { token: 'output-CANARY' },
    error: 'step-error-CANARY',
    diagnostic: { code: 'TRANSFORM_EXECUTION_FAILED', message: 'diagnostic-CANARY',
      originalError: 'diagnostic-CANARY', availableFields: [], suggestion: 'do not retry' },
  }],
  executionOrder: ['api-node'],
  createdAt: '2026-10-20T10:00:00.000Z',
  updatedAt: '2026-10-20T10:00:01.000Z',
};

describe('M19 metadata-only history sanitizer', () => {
  it('allowlists run and step metadata even when a legacy backend returns private and future fields', () => {
    const legacy = {
      ...privateRun,
      futurePrivateField: 'private-future-CANARY',
      leaseOwner: 'private-lease-CANARY',
      stepLogs: [{
        ...privateRun.stepLogs[0],
        futureStepField: 'private-step-CANARY',
      }],
    };
    const summary = toHistorySummaryRun(legacy);
    expect(summary).toEqual({
      _id: 'run-1', workflowId: 'workflow-1', userId: 'user-1',
      retryOfRunId: 'source-run', workflowRevisionId: 'rev-2',
      workflowRevision: 2, definitionHash: 'a'.repeat(64),
      status: 'failed', startedAt: privateRun.startedAt,
      completedAt: privateRun.completedAt,
      triggerType: 'manual', createdAt: privateRun.createdAt,
      updatedAt: privateRun.updatedAt, executionOrder: ['api-node'],
      stepLogs: [{ nodeId: 'api-node', nodeType: 'api_call', nodeLabel: 'Call API',
        status: 'failed', durationMs: 500 }],
    });
    expect(JSON.stringify(summary)).not.toMatch(/CANARY|leaseOwner|futurePrivateField|input|output|diagnostic/);
    expect(summary).not.toBe(legacy);
    expect(summary.stepLogs[0]).not.toBe(legacy.stepLogs[0]);
    expect(summary.executionOrder).not.toBe(legacy.executionOrder);
  });

  it('preserves valid optional fields only when present and does not mutate the original', () => {
    const input = {
      ...privateRun,
      retryOfRunId: undefined, workflowRevisionId: undefined,
      workflowRevision: undefined, definitionHash: undefined,
      completedAt: undefined,
      stepLogs: [{ nodeId: 'start', nodeType: 'start' as const, nodeLabel: 'Start',
        status: 'success' as const }],
    };
    const snapshot = JSON.stringify(input);
    const summary = toHistorySummaryRun(input);
    expect(summary.stepLogs).toEqual([{ nodeId: 'start', nodeType: 'start',
      nodeLabel: 'Start', status: 'success' }]);
    expect(summary).not.toHaveProperty('completedAt');
    expect(summary).not.toHaveProperty('retryOfRunId');
    expect(summary).not.toHaveProperty('workflowRevisionId');
    expect(summary).not.toHaveProperty('workflowRevision');
    expect(summary).not.toHaveProperty('definitionHash');
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
