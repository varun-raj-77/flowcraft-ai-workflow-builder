'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore } from '@/stores/authStore';

const PUBLIC_PATHS = ['/login', '/register'];

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const checkAuth = useAuthStore((s) => s.checkAuth);
  const isPublicPath = PUBLIC_PATHS.some((path) => pathname.startsWith(path));

  // Check auth status on mount
  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);

  // Redirect logic after auth check completes
  useEffect(() => {
    if (isLoading) return;

    if (!isAuthenticated && !isPublicPath) {
      router.replace('/login');
    }

    if (isAuthenticated && isPublicPath) {
      router.replace('/dashboard');
    }
  }, [isAuthenticated, isLoading, isPublicPath, router]);

  // Show loading while checking auth
  // Keep public auth forms mounted while a submission is pending so their
  // local success/error feedback is not discarded by the global auth check.
  if (isLoading && !isPublicPath) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600" />
      </div>
    );
  }

  return <>{children}</>;
}
