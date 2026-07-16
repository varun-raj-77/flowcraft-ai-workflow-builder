// @vitest-environment jsdom
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { JsonViewer } from './JsonViewer';

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

describe('JsonViewer', () => {
  it('bounds large arrays until explicitly expanded', () => {
    render(<JsonViewer value={Array.from({ length: 1000 }, (_, id) => ({ id }))} />);
    expect(screen.getByText(/900 additional items/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Expand all JSON' }));
    expect(screen.queryByText(/900 additional items/i)).toBeNull();
  });

  it('copies redacted JSON and searches nested values', async () => {
    render(<JsonViewer value={{ nested: { token: 'hidden', customer: 'Ada' } }} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search within result' }), { target: { value: 'Ada' } });
    expect(screen.getByText('1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Copy redacted JSON' }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('[REDACTED]'));
  });
});
