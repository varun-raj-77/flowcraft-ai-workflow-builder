'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/Button';
import { APP_NAME } from '@/lib/constants';
import { ApiError } from '@/lib/api';
import { DEMO_ACCOUNT } from './demoAccount';

export default function LoginPage() {
  const router = useRouter();
  const login = useAuthStore((s) => s.login);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDemoDialogOpen, setIsDemoDialogOpen] = useState(false);
  const demoTriggerRef = useRef<HTMLButtonElement>(null);
  const demoDialogRef = useRef<HTMLElement>(null);
  const isSubmittingRef = useRef(false);

  useEffect(() => {
    if (!isDemoDialogOpen) return;
    demoDialogRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || isLoading) return;
      setIsDemoDialogOpen(false);
      window.setTimeout(() => demoTriggerRef.current?.focus(), 0);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [isDemoDialogOpen, isLoading]);

  async function authenticate(loginEmail: string, loginPassword: string, isDemo = false) {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setError(null);
    setIsLoading(true);
    try {
      await login(loginEmail, loginPassword);
      router.push('/dashboard');
    } catch (err) {
      setError(isDemo
        ? 'The demo account is temporarily unavailable. You can still create your own account.'
        : err instanceof ApiError ? err.message : 'Login failed. Please try again.');
    } finally {
      isSubmittingRef.current = false;
      setIsLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await authenticate(email, password);
  }

  async function continueWithDemo() {
    if (isLoading) return;
    setEmail(DEMO_ACCOUNT.email);
    setPassword(DEMO_ACCOUNT.password);
    setIsDemoDialogOpen(false);
    await authenticate(DEMO_ACCOUNT.email, DEMO_ACCOUNT.password, true);
  }

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <span className="text-2xl">◆</span>
          <h1 className="mt-2 text-lg font-bold text-zinc-900 dark:text-zinc-100">
            Sign in to {APP_NAME}
          </h1>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-400">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="email" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={isLoading}
              className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-400/30 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={isLoading}
              className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-400/30 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              placeholder="••••••"
            />
          </div>

          <Button type="submit" isLoading={isLoading} className="w-full">
            Sign in
          </Button>
        </form>

        <p className="mt-6 text-center text-xs text-zinc-500 dark:text-zinc-400">
          Don&apos;t have an account?{' '}
          <Link href="/register" className="font-medium text-zinc-900 hover:underline dark:text-zinc-100">
            Sign up
          </Link>
        </p>
        <div className="mt-5 border-t border-zinc-200 pt-5 text-center dark:border-zinc-800">
          <button ref={demoTriggerRef} type="button" onClick={() => setIsDemoDialogOpen(true)} disabled={isLoading} className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-violet-700 transition-colors hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:opacity-50 dark:text-violet-300 dark:hover:bg-violet-950/30">
            <span aria-hidden="true">{'\u2726'}</span> Try Demo Account
          </button>
        </div>
      </div>
      {isDemoDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !isLoading) setIsDemoDialogOpen(false); }}>
          <section ref={demoDialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="demo-dialog-title" aria-describedby="demo-dialog-description" className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl outline-none dark:border-zinc-700 dark:bg-zinc-900">
            <h2 id="demo-dialog-title" className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Explore FlowCraft</h2>
            <p id="demo-dialog-description" className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-300">Use the demo workspace to explore AI workflow generation, execution history, replay, runtime inspection, and workflow editing.</p>
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">This is a shared demo workspace. Changes may be visible to other visitors.</p>
            <dl className="mt-4 grid gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs dark:border-zinc-700 dark:bg-zinc-800/60">
              <div className="min-w-0"><dt className="text-zinc-500">Demo email</dt><dd className="break-all font-medium text-zinc-900 dark:text-zinc-100">{DEMO_ACCOUNT.email}</dd></div>
              <div className="min-w-0"><dt className="text-zinc-500">Demo password</dt><dd className="break-all font-medium text-zinc-900 dark:text-zinc-100">{DEMO_ACCOUNT.password}</dd></div>
            </dl>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="ghost" onClick={() => { setIsDemoDialogOpen(false); window.setTimeout(() => demoTriggerRef.current?.focus(), 0); }} disabled={isLoading}>Cancel</Button>
              <Button type="button" onClick={() => void continueWithDemo()} isLoading={isLoading}>Continue with Demo</Button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
