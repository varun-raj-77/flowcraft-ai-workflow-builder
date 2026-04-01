import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

// ── Shared base styles ──────────────────────────────────────

const inputBase = cn(
  'w-full rounded-md border border-zinc-200 bg-white px-2.5 py-1.5',
  'text-xs text-zinc-900 placeholder:text-zinc-400',
  'outline-none transition-colors',
  'focus:border-zinc-400 focus:ring-1 focus:ring-zinc-400/30',
  'dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100',
  'dark:placeholder:text-zinc-500 dark:focus:border-zinc-500',
);

// ── TextInput ───────────────────────────────────────────────

interface TextInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  hasError?: boolean;
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
  function TextInput({ hasError, className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          inputBase,
          hasError && 'border-red-400 focus:border-red-400 focus:ring-red-400/30',
          className,
        )}
        {...props}
      />
    );
  },
);

// ── NumberInput ─────────────────────────────────────────────

interface NumberInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  hasError?: boolean;
}

export const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(
  function NumberInput({ hasError, className, ...props }, ref) {
    return (
      <input
        ref={ref}
        type="number"
        className={cn(
          inputBase,
          'tabular-nums',
          hasError && 'border-red-400 focus:border-red-400 focus:ring-red-400/30',
          className,
        )}
        {...props}
      />
    );
  },
);

// ── SelectInput ─────────────────────────────────────────────

interface SelectOption {
  value: string;
  label: string;
}

interface SelectInputProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  options: SelectOption[];
  hasError?: boolean;
}

export const SelectInput = forwardRef<HTMLSelectElement, SelectInputProps>(
  function SelectInput({ options, hasError, className, ...props }, ref) {
    return (
      <select
        ref={ref}
        className={cn(
          inputBase,
          'cursor-pointer appearance-none bg-[length:16px] bg-[right_8px_center] bg-no-repeat pr-8',
          'bg-[url("data:image/svg+xml,%3Csvg%20xmlns%3D%27http%3A//www.w3.org/2000/svg%27%20viewBox%3D%270%200%2020%2020%27%20fill%3D%27%2371717a%27%3E%3Cpath%20fill-rule%3D%27evenodd%27%20d%3D%27M5.23%207.21a.75.75%200%20011.06.02L10%2011.168l3.71-3.938a.75.75%200%20111.08%201.04l-4.25%204.5a.75.75%200%2001-1.08%200l-4.25-4.5a.75.75%200%2001.02-1.06z%27%20clip-rule%3D%27evenodd%27/%3E%3C/svg%3E")]',
          hasError && 'border-red-400 focus:border-red-400 focus:ring-red-400/30',
          className,
        )}
        {...props}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    );
  },
);

// ── TextArea ────────────────────────────────────────────────

interface TextAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  hasError?: boolean;
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(
  function TextArea({ hasError, className, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn(
          inputBase,
          'min-h-[60px] resize-y font-mono text-[11px] leading-relaxed',
          hasError && 'border-red-400 focus:border-red-400 focus:ring-red-400/30',
          className,
        )}
        {...props}
      />
    );
  },
);
