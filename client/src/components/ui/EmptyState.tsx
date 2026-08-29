import React from 'react';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon?: string;
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-4 py-16 text-center', className)}>
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-xl border border-[var(--accent-border)] bg-[var(--accent-surface)] text-2xl text-violet-300">
        {icon && <span role="img" aria-hidden="true">{icon}</span>}
      </div>
      <h3 className="text-base font-semibold text-[var(--text-primary)]">
        {title}
      </h3>
      <p className="mt-1.5 max-w-sm text-sm leading-6 text-[var(--text-muted)]">
        {description}
      </p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
