import { describe, expect, it, vi } from 'vitest';
import { requireTrustedOrigin } from './csrf.middleware';
import { createRateLimiter } from './rateLimit.middleware';

function responseRecorder() {
  const result = { statusCode: 200, body: undefined as unknown, headers: {} as Record<string, unknown> };
  const response = {
    status: vi.fn((statusCode: number) => {
      result.statusCode = statusCode;
      return response;
    }),
    json: vi.fn((body: unknown) => {
      result.body = body;
      return response;
    }),
    setHeader: vi.fn((name: string, value: unknown) => {
      result.headers[name] = value;
    }),
  };
  return { response, result };
}

describe('request security middleware', () => {
  it('rejects a state-changing request from an untrusted origin', () => {
    const { response, result } = responseRecorder();
    const next = vi.fn();
    requireTrustedOrigin(
      { method: 'POST', path: '/auth/login', get: vi.fn(() => 'https://attacker.example') } as never,
      response as never,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(result.statusCode).toBe(403);
    expect(result.body).toEqual({ error: { code: 'UNTRUSTED_ORIGIN', message: 'Request origin is not allowed.' } });
  });

  it('returns 429 after the configured request limit', () => {
    const limiter = createRateLimiter({ name: 'test', max: 1, windowMs: 60_000 });
    const request = { ip: '127.0.0.1', path: '/ai/generate' } as never;

    const first = responseRecorder();
    const next = vi.fn();
    limiter(request, first.response as never, next);
    expect(next).toHaveBeenCalledOnce();

    const second = responseRecorder();
    limiter(request, second.response as never, vi.fn());
    expect(second.result.statusCode).toBe(429);
    expect(second.result.body).toEqual({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' } });
  });
});
