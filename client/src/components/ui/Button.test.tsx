// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Button } from './Button';

afterEach(cleanup);

describe('Button', () => {
  it('defaults to a non-submitting button', () => {
    render(<Button>Open</Button>);

    expect(screen.getByRole('button', { name: 'Open' }).getAttribute('type')).toBe('button');
  });

  it('exposes loading state without adding spinner noise to its accessible name', () => {
    render(<Button isLoading>Save workflow</Button>);

    const button = screen.getByRole('button', { name: 'Save workflow' });
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.hasAttribute('disabled')).toBe(true);
  });
});
