// @vitest-environment jsdom
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
    expect(within(dialog).getByLabelText('Mock output (JSON object)', { selector: 'textarea', exact: true })).toBeTruthy();
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
});
