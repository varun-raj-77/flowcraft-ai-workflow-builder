import { describe, expect, it } from 'vitest';
import { getSocketUrl, resolveSocketUrl } from './socket';

describe('Socket.IO endpoint configuration', () => {
  it('uses localhost only when development is explicitly configured', () => {
    expect(getSocketUrl({ NODE_ENV: 'development' })).toBe('http://localhost:3001');
  });

  it('uses a valid public Socket.IO URL when configured', () => {
    expect(getSocketUrl({ NODE_ENV: 'production', NEXT_PUBLIC_SOCKET_URL: 'https://respectful-communication-production.up.railway.app' }))
      .toBe('https://respectful-communication-production.up.railway.app');
    expect(resolveSocketUrl({ NODE_ENV: 'production', NEXT_PUBLIC_SOCKET_URL: 'https://api.example.com/socket.io' }).source).toBe('socket-url');
    expect(getSocketUrl({ NODE_ENV: 'production', NEXT_PUBLIC_SOCKET_URL: 'https://api.example.com/socket.io' })).toBe('https://api.example.com');
  });

  it('derives the Socket.IO origin from the public API URL when needed', () => {
    expect(resolveSocketUrl({ NODE_ENV: 'production', NEXT_PUBLIC_API_URL: 'https://api.example.com/api' })).toEqual({
      origin: 'https://api.example.com', source: 'api-url', runtime: 'production',
    });
  });

  it('never falls back to localhost outside explicit development', () => {
    expect(() => getSocketUrl({})).toThrow('NEXT_PUBLIC_SOCKET_URL or NEXT_PUBLIC_API_URL');
    expect(() => getSocketUrl({ NODE_ENV: 'production' })).toThrow('NEXT_PUBLIC_SOCKET_URL or NEXT_PUBLIC_API_URL');
  });

  it('rejects invalid production endpoints instead of silently using another origin', () => {
    expect(() => getSocketUrl({ NODE_ENV: 'production', NEXT_PUBLIC_SOCKET_URL: 'http://api.example.com' })).toThrow('public HTTPS');
    expect(() => getSocketUrl({ NODE_ENV: 'production', NEXT_PUBLIC_SOCKET_URL: 'https://localhost:3001' })).toThrow('public HTTPS');
    expect(() => getSocketUrl({ NODE_ENV: 'production', NEXT_PUBLIC_SOCKET_URL: 'https://api.example.com/not-socket' })).toThrow('must be an origin');
  });
});
