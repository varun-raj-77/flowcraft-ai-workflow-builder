import type { Metadata } from 'next';
import { Navbar } from '@/components/layout/Navbar';
import { AuthProvider } from '@/components/layout/AuthProvider';
import { APP_NAME } from '@/lib/constants';
import './globals.css';

export const metadata: Metadata = {
  title: APP_NAME,
  description: 'Build, execute, and generate workflows visually with AI',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full dark">
      <body className="flex h-full flex-col bg-[var(--surface-shell)] text-[var(--text-primary)] antialiased">
        <Navbar />
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
