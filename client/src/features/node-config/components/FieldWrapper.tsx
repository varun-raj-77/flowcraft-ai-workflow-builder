import { cn } from '@/lib/utils';

interface FieldWrapperProps {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}

export function FieldWrapper({
  label,
  htmlFor,
  error,
  hint,
  className,
  children,
}: FieldWrapperProps) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label
        htmlFor={htmlFor}
        className="block text-[11px] font-medium text-zinc-700 dark:text-zinc-300"
      >
        {label}
      </label>

      {children}

      {hint && !error && (
        <p className="text-[10px] text-zinc-400 dark:text-zinc-500">
          {hint}
        </p>
      )}

      {error && (
        <p className="text-[10px] font-medium text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
