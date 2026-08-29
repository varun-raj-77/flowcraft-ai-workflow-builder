// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useRevisionHistoryStore } from '@/stores/revisionHistoryStore';
import { useUIStore } from '@/stores/uiStore';
import { useWorkflowStore } from '@/stores/workflowStore';
import { ConfigPanel } from './ConfigPanel';

beforeEach(() => {
  useWorkflowStore.getState().clearWorkflow();
  useRevisionHistoryStore.getState().reset();
  useRevisionHistoryStore.setState({
    previewRevision: {
      id: 'revision-1',
      workflowId: 'workflow-1',
      revision: 1,
      parentRevisionId: null,
      source: 'manual',
      definitionHash: '1'.repeat(64),
      nodes: [{
        id: 'delay',
        type: 'delay',
        label: 'Historical delay',
        position: { x: 0, y: 0 },
        config: { delayMs: 1200 },
        description: 'Archived configuration',
      }],
      edges: [],
      createdAt: '2026-08-01T00:00:00.000Z',
    },
  });
  useUIStore.getState().selectNode('delay');
});

afterEach(cleanup);

describe('ConfigPanel historical inspection', () => {
  it('renders a read-only node summary without mutation controls', () => {
    render(<ConfigPanel />);

    expect(screen.getByLabelText('Read-only details for Historical delay')).toBeTruthy();
    expect(screen.getByText('Read only · v1')).toBeTruthy();
    expect(screen.getByText(/1200/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delete node' })).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
