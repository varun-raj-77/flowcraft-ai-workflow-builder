'use client';

import type { MouseEventHandler } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuthStore } from '@/stores/authStore';
import { useWorkflowStore } from '@/stores/workflowStore';
import { cn } from '@/lib/utils';
import { APP_NAME } from '@/lib/constants';

interface NavLinkProps {
  href: string;
  children: React.ReactNode;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
}

function NavLink({ href, children, onClick }: NavLinkProps) {
  const pathname = usePathname();
  const isActive = pathname.startsWith(href);

  return (
    <Link
      href={href}
      onClick={onClick}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'fc-focus rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
        isActive
          ? 'bg-[var(--surface-raised)] text-[var(--text-primary)]'
          : 'text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]'
      )}
    >
      {children}
    </Link>
  );
}

export function Navbar() {
  const user = useAuthStore((s) => s.user);
  const pathname = usePathname();

  function confirmEditorExit() {
    return !pathname.startsWith('/editor/')
      || !useWorkflowStore.getState().isDirty
      || window.confirm('Leave the editor with unsaved changes? Your edits may be lost.');
  }

  const guardEditorLink: MouseEventHandler<HTMLAnchorElement> = (event) => {
    // Modified clicks open another tab or window and do not discard this editor.
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (!confirmEditorExit()) event.preventDefault();
  };

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border-faint)] bg-[var(--surface-shell)]/95">
      <div className="mx-auto flex h-14 max-w-screen-2xl items-center justify-between px-4 sm:px-6">
        {/* Left: Logo + Nav */}
        <div className="flex items-center gap-6">
          <Link href="/dashboard" onClick={guardEditorLink} aria-label={`${APP_NAME} dashboard`} className="fc-focus flex items-center gap-2 rounded-md">
            <span className="text-sm text-violet-400">◆</span>
            <span className="text-sm font-semibold tracking-tight text-[var(--text-primary)]">
              {APP_NAME}
            </span>
          </Link>

          <nav className="flex items-center gap-1">
            <NavLink href="/dashboard" onClick={guardEditorLink}>Workflows</NavLink>
          </nav>
        </div>

        {/* Right: User */}
        {user && (
          <div className="flex items-center gap-3">
            <Link href="/account" onClick={guardEditorLink} aria-label="Account settings" className="fc-focus flex items-center gap-2 rounded-md px-1 py-1 transition-colors hover:bg-[var(--surface-hover)]">
              <span className="hidden text-xs text-[var(--text-muted)] sm:inline">
                {user.displayName}
              </span>
              <span className="flex h-7 w-7 items-center justify-center rounded-full border border-[var(--border-default)] bg-[var(--surface-raised)] text-xs font-medium text-[var(--text-secondary)]">
                {user.displayName.charAt(0).toUpperCase()}
              </span>
            </Link>
            <button
              type="button"
              onClick={() => {
                if (confirmEditorExit()) void useAuthStore.getState().logout();
              }}
              className="fc-focus rounded-md px-2 py-1 text-xs text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
