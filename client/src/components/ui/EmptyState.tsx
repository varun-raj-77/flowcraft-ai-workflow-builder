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
      <div className="relative mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-zinc-200 bg-gradient-to-br from-white to-zinc-100 text-3xl shadow-sm dark:border-zinc-700 dark:from-zinc-800 dark:to-zinc-900">
        <span className="absolute -left-1 -top-1 h-3 w-3 rounded-full bg-violet-200 dark:bg-violet-900" />
        <span className="absolute -bottom-1 -right-1 h-2.5 w-2.5 rounded-full bg-sky-200 dark:bg-sky-900" />
        {icon && <span role="img" aria-hidden="true">{icon}</span>}
      </div>
      <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
        {title}
      </h3>
      <p className="mt-1.5 max-w-sm text-sm leading-6 text-zinc-500 dark:text-zinc-400">
        {description}
      </p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
