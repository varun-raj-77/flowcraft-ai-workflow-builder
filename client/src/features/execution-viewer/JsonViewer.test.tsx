// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { JsonViewer } from './JsonViewer';

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

afterEach(cleanup);

describe('JsonViewer', () => {
  it('keeps large arrays bounded when branches are expanded', () => {
    const { container } = render(<JsonViewer value={Array.from({ length: 1000 }, (_, id) => ({ id }))} />);
    expect(container.querySelectorAll('[data-json-array-entry="true"]')).toHaveLength(100);
    expect(screen.getByRole('button', { name: 'Show 100 more array items' }).textContent).toContain('100 of 1000');
    fireEvent.click(screen.getByRole('button', { name: 'Expand JSON branches' }));
    expect(container.querySelectorAll('[data-json-array-entry="true"]')).toHaveLength(100);
    expect(screen.getByRole('button', { name: 'Show 100 more array items' }).textContent).toContain('100 of 1000');
  });

  it('shows large arrays incrementally and collapse resets the page safely', () => {
    const { container } = render(<JsonViewer value={Array.from({ length: 10_000 }, (_, id) => ({ id }))} />);
    const showMore = screen.getByRole('button', { name: 'Show 100 more array items' });
    expect(container.querySelectorAll('[data-json-array-entry="true"]')).toHaveLength(100);
    expect(showMore.textContent).toContain('100 of 10000');
    fireEvent.click(showMore);
    expect(container.querySelectorAll('[data-json-array-entry="true"]')).toHaveLength(200);
    expect(screen.getByRole('button', { name: 'Show 100 more array items' }).textContent).toContain('200 of 10000');
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all JSON' }));
    fireEvent.click(screen.getByRole('button', { name: 'Expand JSON branches' }));
    expect(screen.getByRole('button', { name: 'Show 100 more array items' }).textContent).toContain('100 of 10000');
  });

  it('copies redacted JSON and searches nested values', async () => {
    render(<JsonViewer value={{ nested: { token: 'hidden', customer: 'Ada' } }} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Count matching JSON keys and values' }), { target: { value: 'Ada' } });
    expect(screen.getByText('1 matches')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Copy redacted JSON' }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('[REDACTED]'));
  });

  it('reports a clipboard failure without an unhandled rejection', async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('Permission denied'));
    render(<JsonViewer value={{ result: 'safe' }} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy redacted JSON' }));

    await waitFor(() => expect(screen.getByText('Copy unavailable')).toBeTruthy());
  });
});
