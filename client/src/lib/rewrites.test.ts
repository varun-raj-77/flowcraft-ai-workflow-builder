import { describe, expect, it } from 'vitest';

// next.config.js is CommonJS by design.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nextConfig = require('../../next.config.js');

describe('same-origin API rewrite', () => {
  it('forwards browser /api calls to the server-only API origin', async () => {
    await expect(nextConfig.rewrites()).resolves.toEqual([
      {
        source: '/api/:path*',
        destination: 'http://localhost:3001/api/:path*',
      },
    ]);
  });
});
