import React from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonBaseProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  children: React.ReactNode;
  className?: string;
}

type ButtonAsButton = ButtonBaseProps &
  Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, keyof ButtonBaseProps> & {
    href?: never;
  };

type ButtonAsLink = ButtonBaseProps &
  Omit<React.ComponentProps<typeof Link>, keyof ButtonBaseProps> & {
    href: string;
  };

type ButtonProps = ButtonAsButton | ButtonAsLink;

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    'border border-violet-500/60 bg-violet-600 text-white shadow-sm shadow-violet-950/30 hover:border-violet-400 hover:bg-violet-500',
  secondary:
    'border border-[var(--border-default)] bg-[var(--surface-raised)] text-[var(--text-primary)] hover:border-zinc-500 hover:bg-[var(--surface-hover)]',
  ghost:
    'border border-transparent bg-transparent text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]',
  danger:
    'border border-red-500/50 bg-red-500/15 text-red-300 hover:border-red-400/70 hover:bg-red-500/25',
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
  lg: 'px-5 py-2.5 text-sm',
};

export function Button({
  variant = 'primary',
  size = 'md',
  isLoading = false,
  children,
  className,
  ...props
}: ButtonProps) {
  const classes = cn(
    'inline-flex items-center justify-center gap-2 rounded-lg font-medium',
    'transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--surface-shell)]',
    'disabled:pointer-events-none disabled:border-transparent disabled:bg-[var(--surface-base)] disabled:text-[var(--text-disabled)] disabled:shadow-none disabled:opacity-100',
    variantStyles[variant],
    sizeStyles[size],
    className
  );

  if ('href' in props && props.href) {
    const { href, ...linkProps } = props;
    return (
      <Link href={href} className={classes} {...linkProps}>
        {children}
      </Link>
    );
  }

  const buttonProps = props as React.ButtonHTMLAttributes<HTMLButtonElement>;

  return (
    <button
      {...buttonProps}
      type={buttonProps.type ?? 'button'}
      className={classes}
      disabled={isLoading || buttonProps.disabled}
      aria-busy={isLoading || undefined}
    >
      {isLoading && (
        <span
          aria-hidden="true"
          className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {children}
    </button>
  );
}
