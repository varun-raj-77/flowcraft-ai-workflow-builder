// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';

const mocks = vi.hoisted(() => ({
  user: { _id: 'user-1', email: 'user@example.com', displayName: 'User', isDemoAccount: false },
  changePassword: vi.fn(),
}));

vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (state: typeof mocks) => unknown) => selector(mocks),
}));
vi.mock('@/components/layout/PageLayout', () => ({
  PageLayout: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

import AccountPage from './page';

function fillForm(currentPassword: string, newPassword: string, confirmPassword: string) {
  fireEvent.change(screen.getByLabelText('Current password'), { target: { value: currentPassword } });
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: newPassword } });
  fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: confirmPassword } });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.user = { _id: 'user-1', email: 'user@example.com', displayName: 'User', isDemoAccount: false };
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('Account password security', () => {
  it('shows Change Password to an authenticated normal user', () => {
    render(<AccountPage />);
    expect(screen.getByRole('heading', { name: 'Account Security' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Change Password' })).toBeTruthy();
  });

  it('shows a restricted state instead of the form for the demo account', () => {
    mocks.user = { ...mocks.user, email: 'demo@flowcraft.app', isDemoAccount: true };
    render(<AccountPage />);
    expect(screen.getByText(/unavailable in the shared demo account/i)).toBeTruthy();
    expect(screen.queryByLabelText('Current password')).toBeNull();
  });

  it('requires the current password and focuses it first', () => {
    render(<AccountPage />);
    fillForm('', 'new-password', 'new-password');
    fireEvent.click(screen.getByRole('button', { name: 'Change Password' }));
    expect(screen.getByText('Enter your current password.')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText('Current password'));
    expect(mocks.changePassword).not.toHaveBeenCalled();
  });

  it('requires a new password', () => {
    render(<AccountPage />);
    fillForm('current-password', '', '');
    fireEvent.click(screen.getByRole('button', { name: 'Change Password' }));
    expect(screen.getByText('Enter a new password.')).toBeTruthy();
    expect(mocks.changePassword).not.toHaveBeenCalled();
  });

  it('requires password confirmation', () => {
    render(<AccountPage />);
    fillForm('current-password', 'new-password', '');
    fireEvent.click(screen.getByRole('button', { name: 'Change Password' }));
    expect(screen.getByText('Confirm your new password.')).toBeTruthy();
  });

  it('rejects mismatched confirmation', () => {
    render(<AccountPage />);
    fillForm('current-password', 'new-password', 'different-password');
    fireEvent.click(screen.getByRole('button', { name: 'Change Password' }));
    expect(screen.getByText('Passwords do not match.')).toBeTruthy();
  });

  it('rejects a new password matching the current password', () => {
    render(<AccountPage />);
    fillForm('same-password', 'same-password', 'same-password');
    fireEvent.click(screen.getByRole('button', { name: 'Change Password' }));
    expect(screen.getByText('Your new password must be different from your current password.')).toBeTruthy();
  });

  it('enforces the existing six-character password policy', () => {
    render(<AccountPage />);
    fillForm('current-password', 'short', 'short');
    fireEvent.click(screen.getByRole('button', { name: 'Change Password' }));
    expect(screen.getByText('Use at least 6 characters.', { selector: '#new-password-error' })).toBeTruthy();
  });

  it('submits once, clears fields, and announces success', async () => {
    let finish!: (value: { success: true; message: string }) => void;
    mocks.changePassword.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    render(<AccountPage />);
    fillForm('current-password', 'new-password', 'new-password');
    const button = screen.getByRole('button', { name: 'Change Password' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(mocks.changePassword).toHaveBeenCalledTimes(1);
    expect(mocks.changePassword).toHaveBeenCalledWith('current-password', 'new-password');
    finish({ success: true, message: 'Password changed successfully.' });
    expect(await screen.findByText('Password changed successfully.')).toBeTruthy();
    expect((screen.getByLabelText('Current password') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('New password') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Confirm new password') as HTMLInputElement).value).toBe('');
  });

  it('shows safe feedback for an incorrect current password', async () => {
    mocks.changePassword.mockRejectedValue(new ApiError(400, 'CURRENT_PASSWORD_INCORRECT', 'provider detail'));
    render(<AccountPage />);
    fillForm('wrong-password', 'new-password', 'new-password');
    fireEvent.click(screen.getByRole('button', { name: 'Change Password' }));
    expect(await screen.findByText('The current password is incorrect.')).toBeTruthy();
    expect(screen.queryByText('provider detail')).toBeNull();
  });

  it('shows safe feedback for an unexpected failure', async () => {
    mocks.changePassword.mockRejectedValue(new Error('database detail'));
    render(<AccountPage />);
    fillForm('current-password', 'new-password', 'new-password');
    fireEvent.click(screen.getByRole('button', { name: 'Change Password' }));
    expect(await screen.findByText('Unable to change your password right now. Please try again.')).toBeTruthy();
    expect(screen.queryByText('database detail')).toBeNull();
  });

  it('uses accessible password autocomplete without URL or browser-storage leakage', () => {
    render(<AccountPage />);
    expect(screen.getByLabelText('Current password').getAttribute('autocomplete')).toBe('current-password');
    expect(screen.getByLabelText('New password').getAttribute('autocomplete')).toBe('new-password');
    expect(screen.getByLabelText('Confirm new password').getAttribute('autocomplete')).toBe('new-password');
    fillForm('current-password', 'new-password', 'new-password');
    expect(window.location.search).toBe('');
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });
});
