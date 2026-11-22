// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as api from '@/lib/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listWorkflows: vi.fn(),
  deleteWorkflow: vi.fn(),
  createWorkflow: vi.fn(),
  push: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/features/ai-generator/AIGeneratorModal', () => ({ AIGeneratorModal: () => null }));
vi.mock('@/components/layout/PageLayout', async () => {
  const ReactModule = await import('react');
  return { PageLayout: ({ children }: { children: React.ReactNode }) => ReactModule.createElement('main', null, children) };
});
vi.mock('@/features/workflow-manager/WorkflowList', async () => {
  const ReactModule = await import('react');
  return {
    WorkflowList: ({ workflows, onDelete }: { workflows: Array<{ _id: string; name: string }>; onDelete: (id: string) => void }) => ReactModule.createElement(
      'div',
      null,
      workflows.map((workflow) => ReactModule.createElement(
        'div',
        { key: workflow._id },
        ReactModule.createElement('span', null, workflow.name),
        ReactModule.createElement('button', { type: 'button', onClick: () => onDelete(workflow._id), 'aria-label': `Delete ${workflow.name}` }, 'Delete'),
      )),
    ),
  };
});
vi.mock('@/lib/api', async (importOriginal) => ({
  ...await importOriginal<typeof api>(),
  listWorkflows: mocks.listWorkflows,
  deleteWorkflow: mocks.deleteWorkflow,
  createWorkflow: mocks.createWorkflow,
}));

import DashboardPage from './page';

beforeEach(() => {
  mocks.listWorkflows.mockReset().mockResolvedValue([{
    _id: 'workflow-1',
    userId: 'user-1',
    name: 'Customer sync',
    nodeCount: 4,
    lastExecutionStatus: null,
    isGeneratedByAI: false,
    createdAt: '2026-07-23T00:00:00.000Z',
    updatedAt: '2026-07-23T00:00:00.000Z',
  }]);
  mocks.deleteWorkflow.mockReset().mockResolvedValue(undefined);
  mocks.createWorkflow.mockReset();
  mocks.push.mockReset();
  vi.spyOn(window, 'confirm').mockReturnValue(false);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Dashboard workflow deletion', () => {
  it('renders a skeleton while workflow summaries load', () => {
    mocks.listWorkflows.mockReturnValue(new Promise(() => undefined));
    render(<DashboardPage />);

    expect(screen.getByRole('status', { name: 'Loading workflows' })).toBeTruthy();
  });

  it('requires confirmation before deleting an irreversible workflow', async () => {
    render(<DashboardPage />);
    await screen.findByText('Customer sync');

    fireEvent.click(screen.getByRole('button', { name: 'Delete Customer sync' }));

    expect(window.confirm).toHaveBeenCalledWith('Delete "Customer sync"? This action cannot be undone.');
    expect(mocks.deleteWorkflow).not.toHaveBeenCalled();
  });

  it('removes a workflow after deletion is confirmed', async () => {
    vi.mocked(window.confirm).mockReturnValue(true);
    render(<DashboardPage />);
    await screen.findByText('Customer sync');

    fireEvent.click(screen.getByRole('button', { name: 'Delete Customer sync' }));

    await waitFor(() => expect(mocks.deleteWorkflow).toHaveBeenCalledWith('workflow-1'));
    expect(screen.queryByText('Customer sync')).toBeNull();
  });
});


describe('Dashboard workflow creation', () => {
  it('does not duplicate a create before routing to the acknowledged workflow', async () => {
    let complete!: (workflow: { _id: string }) => void;
    mocks.createWorkflow.mockReturnValue(new Promise((resolve) => { complete = resolve; }));
    render(<DashboardPage />);
    const create = screen.getByRole<HTMLButtonElement>('button', { name: /^\+ New Workflow$/ });

    act(() => { create.click(); create.click(); });
    expect(create.disabled).toBe(true);
    expect(mocks.createWorkflow).toHaveBeenCalledTimes(1);

    await act(async () => { complete({ _id: 'created-1' }); });
    expect(mocks.push).toHaveBeenCalledWith('/editor/created-1');
    expect(screen.getByRole('link', { name: 'Open new workflow' }).getAttribute('href')).toBe('/editor/created-1');
    expect(create.disabled).toBe(true);
    fireEvent.click(create);
    expect(mocks.createWorkflow).toHaveBeenCalledTimes(1);
  });

  it('does not pull the user back into the editor after they leave the dashboard', async () => {
    let complete!: (workflow: { _id: string }) => void;
    mocks.createWorkflow.mockReturnValue(new Promise((resolve) => { complete = resolve; }));
    const { unmount } = render(<DashboardPage />);

    fireEvent.click(screen.getByRole('button', { name: /^\+ New Workflow$/ }));
    unmount();
    await act(async () => { complete({ _id: 'created-1' }); });

    expect(mocks.createWorkflow).toHaveBeenCalledTimes(1);
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('re-enables creation after a definitive failure and only retries on user action', async () => {
    mocks.createWorkflow.mockRejectedValueOnce(new api.ApiError(400, 'WORKFLOW_INVALID', 'Creation failed.'))
      .mockResolvedValueOnce({ _id: 'created-1' });
    render(<DashboardPage />);
    const create = screen.getByRole<HTMLButtonElement>('button', { name: /^\+ New Workflow$/ });

    fireEvent.click(create);
    expect((await screen.findByRole('alert')).textContent).toContain('Creation failed.');
    expect(create.disabled).toBe(false);
    expect(mocks.createWorkflow).toHaveBeenCalledTimes(1);
    expect(mocks.push).not.toHaveBeenCalled();

    fireEvent.click(create);
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/editor/created-1'));
    expect(mocks.createWorkflow).toHaveBeenCalledTimes(2);
  });
});
