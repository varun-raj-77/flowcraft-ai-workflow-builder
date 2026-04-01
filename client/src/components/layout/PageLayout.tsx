import { cn } from '@/lib/utils';

interface PageLayoutProps {
  children: React.ReactNode;
  className?: string;
}

export function PageLayout({ children, className }: PageLayoutProps) {
  return (
    <main className={cn('mx-auto max-w-screen-xl px-4 py-8 sm:px-6', className)}>
      {children}
    </main>
  );
}
