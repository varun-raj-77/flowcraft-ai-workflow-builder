import type { ExecutionRun, StepLog } from '@/types';

export const INSPECTOR_TABS = ['live', 'timeline', 'history', 'variables'] as const;
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

export interface PayloadDiff {
  added: string[];
  removed: string[];
  changed: string[];
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

/**
 * A shallow, bounded comparison deliberately avoids walking large API results.
 * It is intended to orient an operator, not to replace a full JSON diff tool.
 */
export function getPayloadDiff(input: unknown, output: unknown, limit = 50): PayloadDiff {
  const before = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const after = output && typeof output === 'object' && !Array.isArray(output) ? output as Record<string, unknown> : {};
  const beforeKeys = Object.keys(before);
  const afterKeys = Object.keys(after);
  return {
    added: afterKeys.filter((key) => !(key in before)).slice(0, limit),
    removed: beforeKeys.filter((key) => !(key in after)).slice(0, limit),
    changed: afterKeys.filter((key) => key in before && !Object.is(before[key], after[key])).slice(0, limit),
  };
}

/**
 * Returns a bounded preview-size estimate for summary cards. Full payloads
 * remain owned by the run and are rendered incrementally by JsonViewer.
 */
export function getPayloadSize(value: unknown, visitLimit = 200): number {
  let bytes = 0;
  let visited = 0;
  const encoder = new TextEncoder();
  const visit = (item: unknown, depth = 0) => {
    if (visited >= visitLimit || depth > 4) return;
    visited += 1;
    if (typeof item === 'string') { bytes += encoder.encode(item).byteLength + 2; return; }
    if (typeof item === 'number' || typeof item === 'boolean') { bytes += String(item).length; return; }
    if (item === null || item === undefined) { bytes += 4; return; }
    if (Array.isArray(item)) {
      bytes += 2;
      item.slice(0, 50).forEach((child) => visit(child, depth + 1));
      return;
    }
    if (typeof item === 'object') {
      bytes += 2;
      Object.entries(item as Record<string, unknown>).slice(0, 50).forEach(([key, child]) => {
        bytes += encoder.encode(key).byteLength + 3;
        visit(child, depth + 1);
      });
    }
  };
  visit(value);
  return bytes;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
