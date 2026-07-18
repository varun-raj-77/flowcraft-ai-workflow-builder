'use client';

import React, { useRef, useState, type FormEvent } from 'react';
import { PageLayout } from '@/components/layout/PageLayout';
import { Button } from '@/components/ui/Button';
import { ApiError } from '@/lib/api';
import { useAuthStore } from '@/stores/authStore';

interface FieldErrors {
  currentPassword?: string;
  newPassword?: string;
  confirmPassword?: string;
}

const inputClassName = 'mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-400/30 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100';

export default function AccountPage() {
  const user = useAuthStore((state) => state.user);
  const changePassword = useAuthStore((state) => state.changePassword);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSubmittingRef = useRef(false);
  const currentPasswordRef = useRef<HTMLInputElement>(null);
  const newPasswordRef = useRef<HTMLInputElement>(null);
  const confirmPasswordRef = useRef<HTMLInputElement>(null);

  function validate(): FieldErrors {
    const nextErrors: FieldErrors = {};
    if (!currentPassword) nextErrors.currentPassword = 'Enter your current password.';
    if (!newPassword) nextErrors.newPassword = 'Enter a new password.';
    else if (newPassword.length < 6) nextErrors.newPassword = 'Use at least 6 characters.';
    else if (newPassword === currentPassword) nextErrors.newPassword = 'Your new password must be different from your current password.';
    if (!confirmPassword) nextErrors.confirmPassword = 'Confirm your new password.';
    else if (newPassword !== confirmPassword) nextErrors.confirmPassword = 'Passwords do not match.';
    return nextErrors;
  }

  function focusFirstError(nextErrors: FieldErrors) {
    if (nextErrors.currentPassword) currentPasswordRef.current?.focus();
    else if (nextErrors.newPassword) newPasswordRef.current?.focus();
    else if (nextErrors.confirmPassword) confirmPasswordRef.current?.focus();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmittingRef.current) return;

    const nextErrors = validate();
    setErrors(nextErrors);
    setStatus(null);
    if (Object.keys(nextErrors).length > 0) {
      focusFirstError(nextErrors);
      return;
    }

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    try {
      const result = await changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setStatus({ kind: 'success', message: result.message });
    } catch (error) {
      const message = error instanceof ApiError && error.code === 'CURRENT_PASSWORD_INCORRECT'
        ? 'The current password is incorrect.'
        : error instanceof ApiError && error.code === 'PASSWORD_UNCHANGED'
          ? 'Your new password must be different from your current password.'
          : error instanceof ApiError && error.code === 'DEMO_ACCOUNT_RESTRICTED'
            ? 'This action is unavailable in the shared demo account.'
            : 'Unable to change your password right now. Please try again.';
      setStatus({ kind: 'error', message });
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <PageLayout className="max-w-3xl">
      <div className="mb-8">
        <h1 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Account</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Manage security for {user?.email}.</p>
      </div>

      <section aria-labelledby="account-security-title" className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 sm:p-6">
        <h2 id="account-security-title" className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Account Security</h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Change your password to keep your account secure.</p>

        {user?.isDemoAccount ? (
          <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
            Password changes are unavailable in the shared demo account.
          </div>
        ) : (
          <form noValidate onSubmit={handleSubmit} aria-busy={isSubmitting} className="mt-6 max-w-md space-y-4">
            <div>
              <label htmlFor="current-password" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">Current password</label>
              <input ref={currentPasswordRef} id="current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} disabled={isSubmitting} aria-invalid={Boolean(errors.currentPassword)} aria-describedby={errors.currentPassword ? 'current-password-error' : undefined} className={inputClassName} />
              {errors.currentPassword && <p id="current-password-error" className="mt-1 text-xs text-red-600 dark:text-red-400">{errors.currentPassword}</p>}
            </div>

            <div>
              <label htmlFor="new-password" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">New password</label>
              <input ref={newPasswordRef} id="new-password" type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} disabled={isSubmitting} aria-invalid={Boolean(errors.newPassword)} aria-describedby={errors.newPassword ? 'new-password-error' : 'new-password-description'} className={inputClassName} />
              <p id="new-password-description" className="mt-1 text-xs text-zinc-500">Use at least 6 characters.</p>
              {errors.newPassword && <p id="new-password-error" className="mt-1 text-xs text-red-600 dark:text-red-400">{errors.newPassword}</p>}
            </div>

            <div>
              <label htmlFor="confirm-password" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">Confirm new password</label>
              <input ref={confirmPasswordRef} id="confirm-password" type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} disabled={isSubmitting} aria-invalid={Boolean(errors.confirmPassword)} aria-describedby={errors.confirmPassword ? 'confirm-password-error' : undefined} className={inputClassName} />
              {errors.confirmPassword && <p id="confirm-password-error" className="mt-1 text-xs text-red-600 dark:text-red-400">{errors.confirmPassword}</p>}
            </div>

            <div aria-live="polite" aria-atomic="true">
              {status && (
                <p className={status.kind === 'success'
                  ? 'rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300'
                  : 'rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300'}>
                  {status.message}
                </p>
              )}
            </div>

            <Button type="submit" isLoading={isSubmitting} aria-label={isSubmitting ? 'Changing password' : undefined}>
              {isSubmitting ? 'Changing password...' : 'Change Password'}
            </Button>
          </form>
        )}
      </section>
    </PageLayout>
  );
}
