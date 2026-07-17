// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { CapabilityCoverage } from '@/types';
import { GenerationValidationFeedback } from './GenerationValidationFeedback';

const coverage = (missingCapabilities: string[], unsupportedCapabilities: string[] = []): CapabilityCoverage => ({
  requestedCapabilities: missingCapabilities,
  implementedCapabilities: [],
  missingCapabilities,
  unsupportedCapabilities,
  coverage: 0,
  isComplete: false,
});

afterEach(cleanup);

describe('GenerationValidationFeedback', () => {
  it('explains one missing node in first-time-user language', () => {
    render(<GenerationValidationFeedback coverage={coverage(['api_call'])} />);

    expect(screen.getByRole('heading', { name: 'Missing components' })).toBeTruthy();
    expect(screen.getByText('API Call')).toBeTruthy();
    expect(screen.getByText(/no API Call node was generated/i)).toBeTruthy();
  });

  it('explains every missing component separately and renders context-aware suggestions', () => {
    render(<GenerationValidationFeedback coverage={coverage(['transform', 'output'])} />);

    expect(screen.getByText('Transform')).toBeTruthy();
    expect(screen.getByText('Output')).toBeTruthy();
    expect(screen.getByText(/Transform, calculate, filter, merge, or normalize/i)).toBeTruthy();
    expect(screen.getByText(/log or display the final result/i)).toBeTruthy();
  });

  it('expands and collapses prompt help with the keyboard-accessible details control', () => {
    render(<GenerationValidationFeedback coverage={coverage(['api_call', 'transform'])} />);

    const helper = screen.getByText('Improve my prompt').closest('details');
    expect(helper?.open).toBe(false);

    fireEvent.click(screen.getByText('Improve my prompt'));
    expect(helper?.open).toBe(true);
    expect(screen.getByText('Instead of:')).toBeTruthy();
    expect(screen.getByText('API Call to fetch customer data')).toBeTruthy();

    fireEvent.click(screen.getByText('Improve my prompt'));
    expect(helper?.open).toBe(false);
  });
});
