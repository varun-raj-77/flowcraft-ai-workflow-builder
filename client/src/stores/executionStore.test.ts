import { beforeEach, describe, expect, it } from 'vitest';
import type { ExecutionRun } from '@/types';
import { useExecutionStore } from './executionStore';

const fullRun = (id: string): ExecutionRun => ({
  _id: id,
  workflowId: 'workflow-1',
  userId: 'user-1',
  status: 'completed',
  triggerType: 'manual',
  startedAt: '2026-10-20T10:00:00Z',
  completedAt: '2026-10-20T10:00:01Z',
  createdAt: '2026-10-20T10:00:00Z',
  updatedAt: '2026-10-20T10:00:01Z',
  executionOrder: ['node-1'],
  error: 'private-run-CANARY',
  stepLogs: [{
    nodeId: 'node-1', nodeType: 'api_call', nodeLabel: 'API',
    status: 'success', durationMs: 1000,
    input: { accessToken: 'private-input-CANARY' },
    output: { key: 'private-output-CANARY' },
    error: 'private-step-CANARY',
  }],
});

describe('M19 execution history store defense in depth', () => {
  beforeEach(() => useExecutionStore.getState().clearHistory());

  it('drops sensitive fields from initially loaded records, even from direct callers', () => {
    const currentRun = fullRun('live');
    useExecutionStore.getState().setCurrentRun(currentRun);
    const full = fullRun('historical');
    useExecutionStore.getState().setHistoryLoading('workflow-1');
    useExecutionStore.getState().setHistory('workflow-1', [full], 'older-cursor');
    const state = useExecutionStore.getState();
    expect(state.historyRuns.map((run) => run._id)).toEqual(['historical']);
    expect(state.historyRuns[0].stepLogs).toEqual([{ nodeId: 'node-1',
      nodeType: 'api_call', nodeLabel: 'API', status: 'success', durationMs: 1000 }]);
    expect(JSON.stringify(state.historyRuns)).not.toContain('CANARY');
    expect(state.currentRun).toBe(currentRun);
    expect(state.historyNextCursor).toBe('older-cursor');
  });

  it('sanitizes older pages without breaking deduplication or selected run identity', () => {
    const state = useExecutionStore.getState();
    state.setHistoryLoading('workflow-1');
    state.setHistory('workflow-1', [fullRun('first')], 'older');
    useExecutionStore.getState().selectHistoricalRun('first');
    useExecutionStore.getState().setHistoryMoreLoading('workflow-1', 'older');
    useExecutionStore.getState().appendHistoryPage('workflow-1', 'older',
      [fullRun('first'), fullRun('second')], null);
    const result = useExecutionStore.getState();
    expect(result.historyRuns.map((run) => run._id)).toEqual(['first', 'second']);
    expect(result.selectedHistoricalRunId).toBe('first');
    expect(result.historyNextCursor).toBeNull();
    expect(result.historyMoreStatus).toBe('idle');
    expect(JSON.stringify(result.historyRuns)).not.toMatch(/CANARY|accessToken/);
  });
});
