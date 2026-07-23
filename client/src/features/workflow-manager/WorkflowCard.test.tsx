// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowSummary } from '@/types';
import { WorkflowCard } from './WorkflowCard';

const baseWorkflow: WorkflowSummary = {
  _id: 'workflow-1',
  userId: 'user-1',
  name: 'Summary workflow',
  description: 'A workflow summary',
  isGeneratedByAI: false,
  createdAt: '2026-07-16T12:00:00.000Z',
  updatedAt: '2026-07-16T12:00:00.000Z',
};

function renderCard(workflow: WorkflowSummary) {
  render(<WorkflowCard workflow={workflow} onDelete={vi.fn()} />);
}

afterEach(cleanup);

describe('WorkflowCard summaries', () => {
  it('keeps deletion separate from the workflow navigation link', () => {
    const onDelete = vi.fn();
    render(<WorkflowCard workflow={baseWorkflow} onDelete={onDelete} />);

    const deleteButton = screen.getByRole('button', { name: 'Delete Summary workflow' });
    expect(deleteButton.closest('a')).toBeNull();
    fireEvent.click(deleteButton);
    expect(onDelete).toHaveBeenCalledWith('workflow-1');
  });

  it('renders the persisted node count and a completed latest run', () => {
    renderCard({ ...baseWorkflow, nodeCount: 6, lastExecutionStatus: 'completed' });

    expect(screen.getByText('6 nodes')).toBeTruthy();
    expect(screen.getByText('Last run: Completed')).toBeTruthy();
  });

  it('renders an honest empty workflow and never-run state', () => {
    renderCard({ ...baseWorkflow, nodeCount: 0, lastExecutionStatus: null });

    expect(screen.getByText('0 nodes')).toBeTruthy();
    expect(screen.getByText('Never run')).toBeTruthy();
  });

  it('does not treat omitted summary fields as a zero-node or never-run workflow', () => {
    renderCard(baseWorkflow);

    expect(screen.getByText('Node count unavailable')).toBeTruthy();
    expect(screen.getByText('Execution status unavailable')).toBeTruthy();
    expect(screen.queryByText('0 nodes')).toBeNull();
  });
});
