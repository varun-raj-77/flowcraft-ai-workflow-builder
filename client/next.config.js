/** @type {import('next').NextConfig} */
const apiOrigin = (process.env.FLOWCRAFT_API_ORIGIN || 'http://localhost:3001')
  .replace(/\/$/, '');

const nextConfig = {
  reactStrictMode: true,

  typescript: {
    ignoreBuildErrors: true,
  },

  eslint: {
    ignoreDuringBuilds: true,
  },

  // Keep browser requests first-party. The destination is server-only and must
  // never be exposed as a NEXT_PUBLIC_* variable.
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${apiOrigin}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
