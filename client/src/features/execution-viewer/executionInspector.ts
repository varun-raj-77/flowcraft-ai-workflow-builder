import type { ExecutionRun, StepLog } from '@/types';

export const INSPECTOR_TABS = ['live', 'timeline', 'history'] as const;
export type InspectorTab = (typeof INSPECTOR_TABS)[number];

export interface RunSummary {
  successfulSteps: number;
  failedSteps: number;
  skippedSteps: number;
  completedSteps: number;
  totalSteps: number;
  totalDurationMs: number | null;
  currentNode: StepLog | null;
}

export interface TimelineStep {
  log: StepLog;
  executionOrder: number;
  timestamp: number | null;
}

const SENSITIVE_KEY = /authorization|proxy-authorization|cookie|set-cookie|api[-_]?key|token|password|secret|credential/i;

function parseTimestamp(value?: string): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

/** Derives display-only run facts from the existing ExecutionRun fields. */
export function getRunSummary(run: ExecutionRun, now = Date.now()): RunSummary {
  const successfulSteps = run.stepLogs.filter((log) => log.status === 'success').length;
  const failedSteps = run.stepLogs.filter((log) => log.status === 'failed').length;
  const skippedSteps = run.stepLogs.filter((log) => log.status === 'skipped').length;
  const startedAt = parseTimestamp(run.startedAt);
  const completedAt = parseTimestamp(run.completedAt);

  return {
    successfulSteps,
    failedSteps,
    skippedSteps,
    completedSteps: successfulSteps + failedSteps + skippedSteps,
    totalSteps: run.stepLogs.length,
    totalDurationMs: startedAt === null ? null : (completedAt ?? now) - startedAt,
    currentNode: run.stepLogs.find((log) => log.status === 'running') ?? null,
  };
}

/**
 * Uses timestamps when both items have them, then preserves executionOrder as
 * the deterministic fallback for skipped or incompletely persisted steps.
 */
export function buildTimelineSteps(run: ExecutionRun): TimelineStep[] {
  const executionPositions = new Map(run.executionOrder.map((nodeId, index) => [nodeId, index]));

  return run.stepLogs
    .map((log, index) => ({
      log,
      executionOrder: executionPositions.get(log.nodeId) ?? index,
      timestamp: parseTimestamp(log.startedAt) ?? parseTimestamp(log.completedAt),
    }))
    .sort((left, right) => {
      if (left.timestamp !== null && right.timestamp !== null && left.timestamp !== right.timestamp) {
        return left.timestamp - right.timestamp;
      }
      return left.executionOrder - right.executionOrder;
    });
}

export function getLongestDuration(steps: TimelineStep[]): number {
  return Math.max(0, ...steps.map((step) => step.log.durationMs ?? 0));
}

export function getDurationBarPercent(durationMs: number | undefined, longestDuration: number): number {
  if (!durationMs || durationMs <= 0 || longestDuration <= 0) return 0;
  return Math.round((durationMs / longestDuration) * 100);
}

export function formatDateTime(value?: string): string {
  if (!value || Number.isNaN(Date.parse(value))) return '—';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(new Date(value));
}

export function formatDuration(durationMs: number | null | undefined): string {
  if (durationMs === null || durationMs === undefined || durationMs < 0) return '—';
  if (durationMs < 1000) return `${durationMs}ms`;
  const seconds = durationMs / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

/** A client-side second line of defence for persisted inspection data. */
export function redactInspectionValue(value: unknown, key = ''): unknown {
  if (SENSITIVE_KEY.test(key)) return '[REDACTED]';
  if (typeof value === 'string') {
    return value
      .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
      .replace(/\b(api[-_ ]?key|token|password|secret)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]');
  }
  if (Array.isArray(value)) return value.map((item) => redactInspectionValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => [
        childKey,
        redactInspectionValue(childValue, childKey),
      ]),
    );
  }
  return value;
}

export function getNextInspectorTab(current: InspectorTab, key: string): InspectorTab | null {
  const index = INSPECTOR_TABS.indexOf(current);
  if (key === 'Home') return INSPECTOR_TABS[0];
  if (key === 'End') return INSPECTOR_TABS[INSPECTOR_TABS.length - 1];
  if (key === 'ArrowRight') return INSPECTOR_TABS[(index + 1) % INSPECTOR_TABS.length];
  if (key === 'ArrowLeft') return INSPECTOR_TABS[(index - 1 + INSPECTOR_TABS.length) % INSPECTOR_TABS.length];
  return null;
}
