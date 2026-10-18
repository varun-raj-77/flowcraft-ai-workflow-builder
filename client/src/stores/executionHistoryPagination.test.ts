import { beforeEach, describe, expect, it } from 'vitest';
import type { ExecutionRun } from '@/types';
import { MAX_LOADED_HISTORY_RUNS, useExecutionStore } from './executionStore';

const run = (id: string): ExecutionRun => ({
  _id: id, workflowId: 'workflow-a', userId: 'owner', status: 'completed',
  triggerType: 'manual', stepLogs: [], executionOrder: [],
  startedAt: '2026-10-18T12:00:00.000Z', completedAt: '2026-10-18T12:00:01.000Z',
  createdAt: '2026-10-18T12:00:00.000Z', updatedAt: '2026-10-18T12:00:01.000Z',
});

beforeEach(() => useExecutionStore.getState().clearHistory());

describe('M14 workflow-scoped history paging state', () => {
  it('preserves selection and deduplicates page boundaries', () => {
    useExecutionStore.getState().setHistory('workflow-a', [run('one'), run('two')], 'cursor-a');
    useExecutionStore.getState().selectHistoricalRun('one');
    useExecutionStore.getState().setHistoryMoreLoading('workflow-a', 'cursor-a');
    useExecutionStore.getState().appendHistoryPage('workflow-a', 'cursor-a', [run('two'), run('three')], 'cursor-b');
    const state = useExecutionStore.getState();
    expect(state.historyRuns.map((r) => r._id)).toEqual(['one', 'two', 'three']);
    expect(state.selectedHistoricalRunId).toBe('one');
    expect(state.historyNextCursor).toBe('cursor-b');
    expect(state.historyMoreStatus).toBe('idle');
  });

  it('rejects stale cursors and wrong-workflow additions', () => {
    useExecutionStore.getState().setHistory('workflow-a', [run('one')], 'cursor-a');
    useExecutionStore.getState().setHistoryMoreLoading('workflow-a', 'cursor-a');
    useExecutionStore.getState().appendHistoryPage('workflow-a', 'wrong-cursor', [run('bad')], null);
    useExecutionStore.getState().appendHistoryPage('workflow-b', 'cursor-a', [run('bad')], null);
    expect(useExecutionStore.getState().historyRuns.map((r) => r._id)).toEqual(['one']);
    useExecutionStore.getState().setHistory('workflow-b', [], null);
    useExecutionStore.getState().appendHistoryPage('workflow-a', 'cursor-a', [run('bad')], null);
    expect(useExecutionStore.getState().historyRuns).toEqual([]);
  });

  it('caps the in-memory collection and disallows further page fetches', () => {
    const runs = Array.from({ length: MAX_LOADED_HISTORY_RUNS - 2 }, (_, i) => run('r' + i));
    useExecutionStore.getState().setHistory('workflow-a', runs, 'cursor-a');
    useExecutionStore.getState().setHistoryMoreLoading('workflow-a', 'cursor-a');
    useExecutionStore.getState().appendHistoryPage('workflow-a', 'cursor-a',
      Array.from({ length: 20 }, (_, i) => run('new-' + i)), 'cursor-b');
    const state = useExecutionStore.getState();
    expect(state.historyRuns).toHaveLength(MAX_LOADED_HISTORY_RUNS);
    expect(state.historyNextCursor).toBeNull();
    expect(state.historyCapReached).toBe(true);
  });

  it('reports a failed older-page request without discarding loaded history', () => {
    useExecutionStore.getState().setHistory('workflow-a', [run('one')], 'cursor-a');
    useExecutionStore.getState().setHistoryMoreLoading('workflow-a', 'cursor-a');
    useExecutionStore.getState().setHistoryMoreError('workflow-a', 'cursor-a', 'Temporary issue');
    expect(useExecutionStore.getState().historyRuns.map((r) => r._id)).toEqual(['one']);
    expect(useExecutionStore.getState().historyMoreError).toBe('Temporary issue');
    useExecutionStore.getState().setHistoryMoreLoading('workflow-a', 'cursor-a');
    expect(useExecutionStore.getState().historyMoreError).toBeNull();
  });

  it('does not overwrite the active execution when clearing or paging history', () => {
    const current = { ...run('live'), status: 'running' as const };
    useExecutionStore.getState().setCurrentRun(current);
    useExecutionStore.getState().setHistory('workflow-a', [run('one')], 'cursor-a');
    useExecutionStore.getState().setHistoryMoreLoading('workflow-a', 'cursor-a');
    useExecutionStore.getState().appendHistoryPage('workflow-a', 'cursor-a', [run('two')], null);
    useExecutionStore.getState().clearHistory();
    expect(useExecutionStore.getState().currentRun?._id).toBe('live');
    expect(useExecutionStore.getState().isRunning).toBe(true);
  });
});

describe('M15 filter-scoped browsing state', () => {
  it('clears loaded results, comparison selection and cursors when changing filters', () => {
    useExecutionStore.getState().setHistory('workflow-a', [run('one')], 'all-cursor');
    useExecutionStore.getState().selectHistoricalRun('one');
    useExecutionStore.getState().setHistoryLoading('workflow-a', 'failed');
    const state = useExecutionStore.getState();
    expect(state.historyFilter).toBe('failed');
    expect(state.historyRuns).toEqual([]);
    expect(state.historyNextCursor).toBeNull();
    expect(state.selectedHistoricalRunId).toBeNull();
    expect(state.historyStatus).toBe('loading');
  });

  it('does not change current execution or node states on filter reset', () => {
    const active = { ...run('live'), status: 'running' as const };
    useExecutionStore.getState().setCurrentRun(active);
    useExecutionStore.getState().setHistory('workflow-a', [run('one')], 'a');
    useExecutionStore.getState().setHistoryLoading('workflow-a', 'cancelled');
    expect(useExecutionStore.getState().currentRun).toBe(active);
    expect(useExecutionStore.getState().isRunning).toBe(true);
  });
});
