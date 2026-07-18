// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ login: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/stores/authStore', () => ({ useAuthStore: (selector: (state: { login: typeof mocks.login }) => unknown) => selector({ login: mocks.login }) }));

import LoginPage from './page';

afterEach(() => { cleanup(); vi.clearAllMocks(); window.localStorage.clear(); window.sessionStorage.clear(); });

describe('LoginPage demo access', () => {
  it('preserves normal login and registration navigation', async () => {
    mocks.login.mockResolvedValue(undefined);
    render(<LoginPage />);
    expect(screen.getByRole('link', { name: 'Sign up' }).getAttribute('href')).toBe('/register');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'user@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(mocks.login).toHaveBeenCalledWith('user@example.com', 'password'));
  });

  it('opens an accessible shared-workspace dialog and cancel leaves the form unchanged', () => {
    render(<LoginPage />);
    const trigger = screen.getByRole('button', { name: /Try Demo Account/i });
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Explore FlowCraft' })).toBeTruthy();
    expect(screen.getByText(/shared demo workspace/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('');
  });

  it('closes with Escape and restores focus to the trigger', async () => {
    render(<LoginPage />);
    const trigger = screen.getByRole('button', { name: /Try Demo Account/i });
    fireEvent.click(trigger);
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('uses the existing login path once with public demo credentials and no browser leakage', async () => {
    let finish!: () => void;
    mocks.login.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    render(<LoginPage />);
    fireEvent.click(screen.getByRole('button', { name: /Try Demo Account/i }));
    const continueButton = screen.getByRole('button', { name: 'Continue with Demo' });
    fireEvent.click(continueButton);
    fireEvent.click(continueButton);
    expect(mocks.login).toHaveBeenCalledTimes(1);
    expect(mocks.login).toHaveBeenCalledWith('demo@flowcraft.app', 'demo123');
    expect(window.location.search).toBe('');
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    finish();
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/dashboard'));
  });

  it('shows a safe demo-specific failure message', async () => {
    mocks.login.mockRejectedValue(new Error('backend details'));
    render(<LoginPage />);
    fireEvent.click(screen.getByRole('button', { name: /Try Demo Account/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Demo' }));
    expect(await screen.findByText(/demo account is temporarily unavailable/i)).toBeTruthy();
    expect(screen.queryByText('backend details')).toBeNull();
  });
});
