'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { useModalDialog } from '@/lib/useModalDialog';
import * as api from '@/lib/api';
import { useUIStore } from '@/stores/uiStore';
import { useWorkflowStore } from '@/stores/workflowStore';
import { useRevisionHistoryStore } from '@/stores/revisionHistoryStore';
import { useRevisionComparisonStore } from '@/stores/revisionComparisonStore';
import type { SimulationNode, SimulationResult, TestLabAssertionDraft } from '@/types/simulation';
import { buildSimulationScenario, initialConditionBranches, initialSimulationFixtures } from './simulationScenario';

const control = 'fc-control w-full rounded-lg px-3 py-2 text-xs text-[var(--text-primary)]';
const label = 'mb-1.5 block text-[11px] font-semibold text-[var(--text-secondary)]';

export function TestLabPanel() {
  const isOpen = useUIStore((s) => s.isTestLabOpen);
  const close = useUIStore((s) => s.closeTestLab);
  const selectNode = useUIStore((s) => s.selectNode);
  const meta = useWorkflowStore((s) => s.meta);
  const isDirty = useWorkflowStore((s) => s.isDirty);
  const nodes = useWorkflowStore((s) => s.nodes);
  const isHistorical = useRevisionHistoryStore((s) => s.previewRevision !== null);
  const isComparing = useRevisionComparisonStore((s) => s.comparison !== null);
  const workflowId = meta?._id ?? '';
  const revision = meta?.currentRevision ?? 0;
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useModalDialog({ isOpen, onClose: close, canClose: !running, initialFocusRef: closeButtonRef });
  const simNodes: SimulationNode[] = useMemo(() => nodes.map((node) => ({
    id: node.id, label: String(node.data.label), type: node.data.nodeType,
  })), [nodes]);
  const mocks = simNodes.filter((node) => ['api_call', 'transform', 'condition'].includes(node.type));

  const [fixtures, setFixtures] = useState<Record<string, string>>(() => initialSimulationFixtures(simNodes));
  const [branches, setBranches] = useState<Record<string, 'true' | 'false'>>(() => initialConditionBranches(simNodes));
  const [expectedBranches, setExpectedBranches] = useState<Record<string, '' | 'true' | 'false'>>({});
  const [assertions, setAssertions] = useState<TestLabAssertionDraft[]>([]);
  const nextId = useRef(0);
  const busy = useRef(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [error, setError] = useState('');

  // New revisions get new fixtures; unsaved changes are never silently simulated.
  useEffect(() => {
    setFixtures(initialSimulationFixtures(simNodes));
    setBranches(initialConditionBranches(simNodes));
    setExpectedBranches({});
    setAssertions([]);
    setResult(null);
    setError('');
    // Reset only on saved revision/identity change, not every graph edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowId, revision]);

  const blocked = !workflowId || !revision || isDirty || isHistorical || isComparing;
  const blockMessage = !workflowId || !revision
    ? 'Save this workflow before simulating.'
    : isHistorical || isComparing
      ? 'Return to the current revision before simulating.'
      : isDirty
        ? 'Unsaved changes are not included in the pinned revision. Save your changes first.'
        : '';

  const run = async () => {
    if (blocked || busy.current) return;
    busy.current = true;
    setRunning(true);
    setError('');
    setResult(null);
    try {
      const scenario = buildSimulationScenario({
        revision, nodes: simNodes, fixtures, conditionBranches: branches, expectedBranches, assertions,
      });
      const response = await api.simulateWorkflow(workflowId, scenario);
      const latest = useWorkflowStore.getState();
      if (latest.meta?._id !== workflowId || latest.meta?.currentRevision !== revision || latest.isDirty
        || useRevisionHistoryStore.getState().previewRevision || useRevisionComparisonStore.getState().comparison) {
        setError('The workflow changed during the simulation. Save and run it again.');
      } else if (response.provenance.workflowRevision !== revision) {
        setError('The simulation referenced a different workflow revision. Refresh and retry.');
      } else {
        setResult(response);
      }
    } catch (caught) {
      setError(api.getApiErrorMessage(caught, caught instanceof Error ? caught.message : 'Simulation failed.'));
    } finally {
      busy.current = false;
      setRunning(false);
    }
  };

  const updateAssertion = (id: string, patch: Partial<TestLabAssertionDraft>) => {
    setAssertions((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item));
    setResult(null);
  };

  if (!isOpen) return null;

  return <div className="fixed inset-0 z-50 flex justify-end bg-black/65 backdrop-blur-[2px]" onMouseDown={(event) => {
    if (event.target === event.currentTarget && !running) close();
  }}>
    <div ref={panelRef} role="dialog" aria-modal="true" aria-label="Workflow Test Lab" tabIndex={-1}
      className="flex h-full w-full max-w-[580px] flex-col overflow-hidden border-l border-[var(--border-default)] bg-[var(--surface-shell)] shadow-2xl">
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--border-subtle)] px-5 py-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-violet-300">FlowCraft · Developer tools</p>
          <h2 className="mt-1 text-lg font-semibold text-[var(--text-primary)]">Workflow Test Lab</h2>
          <p className="mt-1 text-xs text-[var(--text-muted)]">Test a saved revision without network calls, JavaScript execution, or side effects.</p>
        </div>
        <button ref={closeButtonRef} type="button" aria-label="Close Test Lab" onClick={close} disabled={running}
          className="fc-focus rounded-lg border border-[var(--border-faint)] px-2 py-1 text-lg text-[var(--text-secondary)]">×</button>
      </div>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
        <section className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--text-primary)]">Pinned definition</span>
            <span className="rounded-md border border-violet-500/30 bg-violet-500/10 px-2 py-1 font-mono text-xs text-violet-200">{revision ? 'v' + revision : 'Unsaved'}</span>
          </div>
          <p className="mt-1 truncate text-xs text-[var(--text-muted)]">{meta?.name ?? 'Untitled Workflow'} · {simNodes.length} nodes</p>
          {blockMessage && <p role="alert" className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">{blockMessage}</p>}
        </section>

        <section aria-label="Simulation fixtures">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">1. Mock node outputs</h3>
          <p className="mb-3 mt-1 text-xs text-[var(--text-muted)]">Transform code and Condition expressions are never evaluated. Provide the outputs they would return.</p>
          {mocks.length ? <div className="space-y-3">{mocks.map((node) => <div key={node.id}
            className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="truncate text-xs font-semibold text-[var(--text-primary)]">{node.label}</span>
              <span className="shrink-0 rounded bg-violet-500/10 px-2 py-1 text-[10px] text-violet-300">{node.type.replace('_', ' ')}</span>
            </div>
            {node.type === 'condition' ? <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor={'sim-branch-' + node.id} className={label}>Simulated branch</label>
                <select id={'sim-branch-' + node.id} className={control} disabled={running} value={branches[node.id] ?? 'true'}
                  onChange={(event) => { setBranches((prev) => ({ ...prev, [node.id]: event.target.value as 'true' | 'false' })); setResult(null); }}>
                  <option value="true">True</option><option value="false">False</option>
                </select>
              </div>
              <div>
                <label htmlFor={'sim-expected-' + node.id} className={label}>Expected branch</label>
                <select id={'sim-expected-' + node.id} className={control} disabled={running} value={expectedBranches[node.id] ?? ''}
                  onChange={(event) => { setExpectedBranches((prev) => ({ ...prev, [node.id]: event.target.value as '' | 'true' | 'false' })); setResult(null); }}>
                  <option value="">No assertion</option><option value="true">True</option><option value="false">False</option>
                </select>
              </div>
            </div> : <div>
              <label htmlFor={'sim-fixture-' + node.id} className={label}>Mock output (JSON object)</label>
              <textarea id={'sim-fixture-' + node.id} rows={5} spellCheck={false} disabled={running} value={fixtures[node.id] ?? ''}
                className={control + ' resize-y font-mono leading-5'}
                onChange={(event) => { setFixtures((prev) => ({ ...prev, [node.id]: event.target.value })); setResult(null); }}/>
            </div>}
          </div>)}</div> : <p className="rounded-lg border border-dashed border-[var(--border-default)] p-3 text-xs text-[var(--text-muted)]">
            No mocks required. Start, Delay, Output and End nodes are simulated automatically.
          </p>}
        </section>

        <section aria-label="Output assertions">
          <div className="mb-3 flex items-start justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">2. Check expected results</h3>
              <p className="mt-1 text-xs text-[var(--text-muted)]">Assertions compare fields to JSON values (e.g. 200, true, or &quot;ok&quot;).</p>
            </div>
            <Button size="sm" variant="secondary" disabled={running || !simNodes.length || assertions.length >= 100}
              onClick={() => {
                nextId.current += 1;
                setAssertions((items) => [...items, { id: String(nextId.current), nodeId: simNodes[0].id, path: '', expectedJson: 'null' }]);
                setResult(null);
              }}>+ Add</Button>
          </div>
          {assertions.length === 0 && <p className="rounded-lg border border-dashed border-[var(--border-default)] p-3 text-xs text-[var(--text-muted)]">No value assertions yet. Add a check to verify a node output.</p>}
          <div className="space-y-3">{assertions.map((check, index) => <div key={check.id}
            className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-3">
            <div className="mb-3 flex items-center justify-between">
              <strong className="text-xs text-[var(--text-primary)]">Assertion {index + 1}</strong>
              <button type="button" disabled={running} className="fc-focus rounded px-2 py-1 text-xs text-red-300"
                onClick={() => { setAssertions((items) => items.filter((item) => item.id !== check.id)); setResult(null); }}>Remove</button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label} htmlFor={'sim-node-' + check.id}>Node</label>
                <select id={'sim-node-' + check.id} className={control} disabled={running} value={check.nodeId}
                  onChange={(event) => updateAssertion(check.id, { nodeId: event.target.value })}>
                  {simNodes.map((node) => <option value={node.id} key={node.id}>{node.label}</option>)}
                </select>
              </div>
              <div>
                <label className={label} htmlFor={'sim-path-' + check.id}>Output field (optional)</label>
                <input id={'sim-path-' + check.id} className={control} disabled={running} placeholder="e.g. status" value={check.path}
                  onChange={(event) => updateAssertion(check.id, { path: event.target.value })}/>
              </div>
            </div>
            <label className={label + ' mt-3'} htmlFor={'sim-value-' + check.id}>Expected JSON value</label>
            <input id={'sim-value-' + check.id} className={control + ' font-mono'} disabled={running} value={check.expectedJson}
              onChange={(event) => updateAssertion(check.id, { expectedJson: event.target.value })}/>
          </div>)}</div>
        </section>

        {(error || result) && <section aria-label="Simulation results" aria-live="polite" className="space-y-3">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">3. Results</h3>
          {error && <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">{error}</p>}
          {result && <>
            <div className={'rounded-xl border p-4 ' + (result.status === 'passed'
              ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-red-500/30 bg-red-500/10')}>
              <div className="flex items-center justify-between gap-2">
                <strong className={result.status === 'passed' ? 'text-emerald-200' : 'text-red-200'}>
                  {result.status === 'passed' ? 'Simulation passed' : 'Simulation failed'}
                </strong>
                <span className="font-mono text-xs text-[var(--text-muted)]">Verified v{result.provenance.workflowRevision}</span>
              </div>
              <p className="mt-1 text-xs text-[var(--text-secondary)]">{result.assertions.filter((item) => item.passed).length}/{result.assertions.length} checks passed · {result.steps.filter((step) => step.status === 'failed').length} node failures</p>
              {result.assertions.length === 0 && <p className="mt-2 text-xs text-[var(--text-muted)]">No assertions were added. Add checks to verify expected behavior.</p>}
            </div>
            <div>
              <h4 className="mb-2 text-xs font-semibold text-[var(--text-secondary)]">Simulated steps</h4>
              <ol className="space-y-1.5">{result.steps.map((step) => <li key={step.nodeId}
                className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border-faint)] p-2 text-xs">
                <button type="button" onClick={() => { close(); selectNode(step.nodeId); }}
                  className="fc-focus min-w-0 truncate text-left text-[var(--text-primary)] hover:underline">
                  {simNodes.find((node) => node.id === step.nodeId)?.label ?? step.nodeId}
                </button>
                <span className={'shrink-0 ' + (step.status === 'failed' ? 'text-red-300' : step.status === 'skipped' ? 'text-[var(--text-muted)]' : 'text-emerald-300')}>
                  {step.status}{step.error ? ' · ' + step.error : ''}
                </span>
              </li>)}</ol>
            </div>
            {result.assertions.length > 0 && <div>
              <h4 className="mb-2 text-xs font-semibold text-[var(--text-secondary)]">Assertions</h4>
              <ul className="space-y-1.5">{result.assertions.map((check, index) => <li key={check.nodeId + (check.path ?? '') + index}
                className="rounded-lg border border-[var(--border-faint)] p-2 text-xs">
                <span className={check.passed ? 'text-emerald-300' : 'text-red-300'}>{check.passed ? '✓ Pass' : '✕ Fail'}</span>
                <span className="ml-2 text-[var(--text-secondary)]">
                  {simNodes.find((node) => node.id === check.nodeId)?.label ?? check.nodeId}{check.path ? ' · ' + check.path : ''} — {check.message}
                </span>
              </li>)}</ul>
            </div>}
          </>}
        </section>}
      </div>
      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-[var(--border-subtle)] bg-[var(--surface-raised)] px-5 py-4">
        <div>
          <p className="text-xs font-semibold text-[var(--text-primary)]">Simulation only</p>
          <p className="text-[10px] text-[var(--text-muted)]">No HTTP requests to your API nodes or persisted test runs</p>
        </div>
        <Button disabled={blocked || !simNodes.length} isLoading={running} onClick={() => { void run(); }}>
          {running ? 'Simulating…' : 'Run simulation'}
        </Button>
      </div>
    </div>
  </div>;
}
