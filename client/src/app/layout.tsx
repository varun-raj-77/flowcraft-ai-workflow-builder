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
    <html lang="en" className="h-full">
      <body className="flex h-full flex-col bg-white text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-100">
        <Navbar />
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
