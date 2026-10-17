// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { TestLabPanel } from './TestLabPanel';
import * as api from '@/lib/api';
import { toFlowNode, useWorkflowStore } from '@/stores/workflowStore';
import { useUIStore } from '@/stores/uiStore';
import { useRevisionHistoryStore } from '@/stores/revisionHistoryStore';
import { useRevisionComparisonStore } from '@/stores/revisionComparisonStore';
import type { SimulationResult, WorkflowNode } from '@/types';

const workflowNodes: WorkflowNode[] = [
  { id: 'start', type: 'start', label: 'Start', position: { x: 0, y: 0 }, config: {} },
  { id: 'fetch', type: 'api_call', label: 'Fetch data', position: { x: 100, y: 0 },
    config: { url: 'https://example.test/posts', method: 'GET', headers: {} } },
  { id: 'transform', type: 'transform', label: 'Count posts', position: { x: 200, y: 0 },
    config: { transformCode: 'return {count: 3};' } },
  { id: 'condition', type: 'condition', label: 'Decide', position: { x: 300, y: 0 },
    config: { expression: 'true' } },
  { id: 'output', type: 'output', label: 'Log', position: { x: 400, y: 0 },
    config: { logLevel: 'info', message: 'Done' } },
];

const fakeResult: SimulationResult = {
  status: 'passed',
  steps: [
    { nodeId: 'start', nodeType: 'start', status: 'simulated' },
    { nodeId: 'fetch', nodeType: 'api_call', status: 'mocked' },
    { nodeId: 'transform', nodeType: 'transform', status: 'mocked' },
    { nodeId: 'condition', nodeType: 'condition', status: 'mocked' },
    { nodeId: 'output', nodeType: 'output', status: 'simulated' },
  ],
  assertions: [{ nodeId: 'fetch', path: 'status', passed: true, message: 'Expected value matched' }],
  provenance: { workflowRevision: 2, definitionHash: 'b'.repeat(64) },
};

beforeEach(() => {
  vi.restoreAllMocks();
  useUIStore.setState({ isTestLabOpen: true, selectedNodeId: null });
  useWorkflowStore.setState({
    meta: { _id: 'workflow-1', name: 'Fetch posts', currentRevision: 2, isGeneratedByAI: false },
    nodes: workflowNodes.map(toFlowNode), edges: [], isDirty: false,
  });
  useRevisionHistoryStore.getState().reset();
  useRevisionComparisonStore.getState().reset();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Test Lab visual workflow', () => {
  it('exposes node-specific mock editors, branch control and pinned revision', () => {
    render(<TestLabPanel />);
    const dialog = screen.getByRole('dialog', { name: 'Workflow Test Lab' });
    expect(within(dialog).getByText('v2')).toBeTruthy();
    expect(within(dialog).getAllByLabelText('Mock output (JSON object)', { selector: 'textarea', exact: true })).toHaveLength(2);
    expect(within(dialog).getByLabelText('Simulated branch')).toBeTruthy();
    expect(within(dialog).getByLabelText('Expected branch')).toBeTruthy();
    expect(within(dialog).getByText(/without network calls, JavaScript execution/i)).toBeTruthy();
  });

  it('builds a revision-pinned request and renders passing steps and assertions', async () => {
    const simulation = vi.spyOn(api, 'simulateWorkflow').mockResolvedValue(fakeResult);
    render(<TestLabPanel />);
    const dialog = screen.getByRole('dialog', { name: 'Workflow Test Lab' });
    fireEvent.click(within(dialog).getByRole('button', { name: '+ Add' }));
    fireEvent.change(within(dialog).getByLabelText('Node'), { target: { value: 'fetch' } });
    fireEvent.change(within(dialog).getByLabelText('Output field (optional)'), { target: { value: 'status' } });
    fireEvent.change(within(dialog).getByLabelText('Expected JSON value'), { target: { value: '200' } });
    fireEvent.change(within(dialog).getByLabelText('Expected branch'), { target: { value: 'false' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Run simulation' }));
    await waitFor(() => expect(simulation).toHaveBeenCalledTimes(1));
    expect(simulation.mock.calls[0][0]).toBe('workflow-1');
    expect(simulation.mock.calls[0][1]).toMatchObject({
      expectedRevision: 2,
      mocks: { fetch: { status: 200, data: [], headers: {} }, transform: { data: null }, condition: { branchTaken: 'true' } },
      assertions: [{ nodeId: 'fetch', path: 'status', equals: 200 }],
      expectedBranches: { condition: 'false' },
    });
    expect(await within(dialog).findByText('Simulation passed')).toBeTruthy();
    expect(within(dialog).getByText('1/1 checks passed · 0 node failures')).toBeTruthy();
  });

  it('does not call the server for unsaved workflow changes', () => {
    useWorkflowStore.setState({ isDirty: true });
    const simulation = vi.spyOn(api, 'simulateWorkflow');
    render(<TestLabPanel />);
    expect(screen.getByText(/Save your changes first/i)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Run simulation' }) as HTMLButtonElement).disabled).toBe(true);
    expect(simulation).not.toHaveBeenCalled();
  });

  it('validates fixture JSON locally and displays an actionable error', async () => {
    const simulation = vi.spyOn(api, 'simulateWorkflow');
    render(<TestLabPanel />);
    const editors = screen.getAllByLabelText('Mock output (JSON object)', { selector: 'textarea', exact: true });
    fireEvent.change(editors[0], { target: { value: '{ broken' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run simulation' }));
    expect(await screen.findByText(/Fetch data: enter a valid JSON object/i)).toBeTruthy();
    expect(simulation).not.toHaveBeenCalled();
  });

  it('surfaces backend revision conflicts instead of reporting success', async () => {
    vi.spyOn(api, 'simulateWorkflow').mockRejectedValue(
      new api.ApiError(409, 'WORKFLOW_REVISION_CONFLICT', 'The workflow revision changed. Refresh before simulating.'),
    );
    render(<TestLabPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Run simulation' }));
    expect(await screen.findByText(/workflow revision changed/i)).toBeTruthy();
    expect(screen.queryByText('Simulation passed')).toBeNull();
  });

  it('does not show a stale success if the editor changes before the response arrives', async () => {
    let release: ((value: SimulationResult) => void) | undefined;
    vi.spyOn(api, 'simulateWorkflow').mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    render(<TestLabPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Run simulation' }));
    useWorkflowStore.setState({ isDirty: true });
    release?.(fakeResult);
    expect(await screen.findByText(/workflow changed during the simulation/i)).toBeTruthy();
    expect(screen.queryByText('Simulation passed')).toBeNull();
  });

  it('focuses a simulated node on the canvas without changing the workflow', async () => {
    vi.spyOn(api, 'simulateWorkflow').mockResolvedValue(fakeResult);
    render(<TestLabPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Run simulation' }));
    const results = await screen.findByRole('region', { name: 'Simulation results' });
    fireEvent.click(within(results).getByRole('button', { name: 'Count posts' }));
    expect(useUIStore.getState().isTestLabOpen).toBe(false);
    expect(useUIStore.getState().selectedNodeId).toBe('transform');
    expect(useWorkflowStore.getState().isDirty).toBe(false);
  });

  it('requests AI explanation only after a failed pinned simulation and renders advice without edits', async () => {
    const failed: SimulationResult = {
      ...fakeResult,
      status: 'failed',
      assertions: [{ nodeId: 'fetch', path: 'status', passed: false, message: 'Expected value did not match' }],
    };
    const simulate = vi.spyOn(api, 'simulateWorkflow').mockResolvedValue(failed);
    const diagnose = vi.spyOn(api, 'diagnoseSimulation').mockResolvedValue({
      provider: 'anthropic',
      model: 'test-haiku',
      provenance: failed.provenance,
      findings: [{
        nodeId: 'fetch',
        action: 'review_assertion',
        explanation: 'The assertion did not match the mocked HTTP status.',
        suggestedNextStep: 'Inspect the expected status and compare it with the fixture.',
        confidence: 'medium',
      }],
      disclaimer: 'Advisory only. No real workflow code ran.',
    });
    render(<TestLabPanel />);
    expect(screen.queryByRole('button', { name: 'Explain failure' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Run simulation' }));
    expect(await screen.findByText('Simulation failed')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Explain failure' }));
    await waitFor(() => expect(diagnose).toHaveBeenCalledTimes(1));
    expect(diagnose.mock.calls[0]).toEqual(simulate.mock.calls[0]);
    expect(await screen.findByText('The assertion did not match the mocked HTTP status.')).toBeTruthy();
    expect(screen.getByText(/Inspect the expected status/)).toBeTruthy();
    expect(screen.getByText(/Advisory only/)).toBeTruthy();
    expect(useWorkflowStore.getState().isDirty).toBe(false);
  });

  it('never calls the provider on a passing test and shows provider errors on failures', async () => {
    const diagnose = vi.spyOn(api, 'diagnoseSimulation');
    vi.spyOn(api, 'simulateWorkflow').mockResolvedValueOnce(fakeResult).mockResolvedValueOnce({
      ...fakeResult,
      status: 'failed',
      assertions: [{ nodeId: 'fetch', passed: false, message: 'Expected value did not match' }],
    });
    diagnose.mockRejectedValue(new api.ApiError(503, 'AI_UNAVAILABLE', 'AI diagnosis is temporarily unavailable.'));
    render(<TestLabPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Run simulation' }));
    expect(await screen.findByText('Simulation passed')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Explain failure' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Run simulation' }));
    expect(await screen.findByText('Simulation failed')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Explain failure' }));
    expect(await screen.findByText(/AI diagnosis is temporarily unavailable/)).toBeTruthy();
    expect(diagnose).toHaveBeenCalledTimes(1);
  });

  it('does not show AI advice after a fixture changes and the simulation is invalidated', async () => {
    const failed: SimulationResult = { ...fakeResult, status: 'failed',
      assertions: [{ nodeId: 'fetch', passed: false, message: 'Mismatch' }] };
    vi.spyOn(api, 'simulateWorkflow').mockResolvedValue(failed);
    const diagnose = vi.spyOn(api, 'diagnoseSimulation');
    render(<TestLabPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Run simulation' }));
    expect(await screen.findByText('Simulation failed')).toBeTruthy();
    const fixtures = screen.getAllByLabelText('Mock output (JSON object)', { selector: 'textarea', exact: true });
    fireEvent.change(fixtures[0], { target: { value: '{"status":201,"data":[]}' } });
    expect(screen.queryByRole('button', { name: 'Explain failure' })).toBeNull();
    expect(diagnose).not.toHaveBeenCalled();
  });

  it('switches to isolated mode, hides script fixtures and sends only API mocks', async () => {
    const simulation = vi.spyOn(api, 'simulateWorkflow').mockResolvedValue({
      ...fakeResult,
      mode: 'isolated',
    });
    render(<TestLabPanel />);
    const panel = screen.getByRole('dialog', { name: 'Workflow Test Lab' });
    fireEvent.change(within(panel).getByLabelText('Execution mode'), { target: { value: 'isolated' } });
    expect(within(panel).getByText(/Actual saved Transform code runs in isolated QuickJS/)).toBeTruthy();
    expect(within(panel).queryByLabelText('Simulated branch')).toBeNull();
    expect(within(panel).getAllByLabelText('Mock output (JSON object)', { selector: 'textarea', exact: true })).toHaveLength(1);
    fireEvent.change(within(panel).getByLabelText('Expected branch'), { target: { value: 'true' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Run simulation' }));
    await waitFor(() => expect(simulation).toHaveBeenCalledOnce());
    expect(simulation.mock.calls[0][1]).toMatchObject({
      mode: 'isolated',
      expectedRevision: 2,
      mocks: { fetch: { status: 200, data: [], headers: {} } },
      expectedBranches: { condition: 'true' },
    });
    expect(Object.keys(simulation.mock.calls[0][1].mocks)).toEqual(['fetch']);
    expect(await within(panel).findByText('Isolated logic execution steps')).toBeTruthy();
  });

  it('never offers fixture-only AI diagnosis for isolated script errors', async () => {
    const diagnosis = vi.spyOn(api, 'diagnoseSimulation');
    vi.spyOn(api, 'simulateWorkflow').mockResolvedValue({
      ...fakeResult, mode: 'isolated', status: 'failed',
      steps: [{ nodeId: 'transform', nodeType: 'transform', status: 'failed', error: 'SCRIPT_GUEST_ERROR' }],
    });
    render(<TestLabPanel />);
    fireEvent.change(screen.getByLabelText('Execution mode'), { target: { value: 'isolated' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run simulation' }));
    expect(await screen.findByText('Simulation failed')).toBeTruthy();
    expect(screen.getByText(/SCRIPT_GUEST_ERROR/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Explain failure' })).toBeNull();
    expect(diagnosis).not.toHaveBeenCalled();
  });
});
