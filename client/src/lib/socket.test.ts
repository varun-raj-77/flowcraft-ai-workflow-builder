import { describe, expect, it } from 'vitest';
import { getSocketUrl } from './socket';

describe('Socket.IO endpoint configuration', () => {
  it('remains a separate public endpoint and never falls back to localhost in production', () => {
    expect(() => getSocketUrl({ NODE_ENV: 'production' })).toThrow('NEXT_PUBLIC_SOCKET_URL');
    expect(() => getSocketUrl({ NODE_ENV: 'production', NEXT_PUBLIC_SOCKET_URL: 'http://localhost:3001' })).toThrow('public HTTPS');
    expect(getSocketUrl({ NODE_ENV: 'production', NEXT_PUBLIC_SOCKET_URL: 'https://respectful-communication-production.up.railway.app' }))
      .toBe('https://respectful-communication-production.up.railway.app');
  });
});
