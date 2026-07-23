// @vitest-environment jsdom
import React, { useRef, useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useModalDialog } from './useModalDialog';

function DialogHarness() {
  const [isOpen, setIsOpen] = useState(false);
  const initialFocusRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useModalDialog({
    isOpen,
    onClose: () => setIsOpen(false),
    initialFocusRef,
  });

  return <>
    <button type="button" onClick={() => setIsOpen(true)}>Open dialog</button>
    {isOpen && (
      <div ref={dialogRef} role="dialog" aria-label="Example dialog" tabIndex={-1}>
        <button type="button">First action</button>
        <button ref={initialFocusRef} type="button">Last action</button>
      </div>
    )}
  </>;
}

afterEach(cleanup);

describe('useModalDialog', () => {
  it('locks background scroll, traps focus, closes with Escape, and restores focus', () => {
    render(<DialogHarness />);
    const trigger = screen.getByRole('button', { name: 'Open dialog' });
    trigger.focus();
    fireEvent.click(trigger);

    const first = screen.getByRole('button', { name: 'First action' });
    const last = screen.getByRole('button', { name: 'Last action' });
    expect(document.activeElement).toBe(last);
    expect(document.body.style.overflow).toBe('hidden');

    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.style.overflow).toBe('');
    expect(document.activeElement).toBe(trigger);
  });
});
