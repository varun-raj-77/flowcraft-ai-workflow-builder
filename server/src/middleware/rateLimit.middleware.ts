import { type Request, type Response, type NextFunction } from 'express';

interface RateLimitOptions {
  name: string;
  windowMs: number;
  max: number;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

/**
 * Bounded in-process limiter for the current single-service deployment.
 * Replace the store with Redis before running multiple API replicas.
 */
export function createRateLimiter({ name, windowMs, max }: RateLimitOptions) {
  const entries = new Map<string, RateLimitEntry>();
  let lastPruneAt = 0;

  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    if (now - lastPruneAt >= windowMs) {
      for (const [key, entry] of entries) {
        if (entry.resetAt <= now) entries.delete(key);
      }
      lastPruneAt = now;
    }
    const key = `${name}:${req.ip}`;
    const existing = entries.get(key);
    const entry = !existing || existing.resetAt <= now
      ? { count: 0, resetAt: now + windowMs }
      : existing;

    entry.count += 1;
    entries.set(key, entry);

    res.setHeader('RateLimit-Limit', max);
    res.setHeader('RateLimit-Remaining', Math.max(0, max - entry.count));
    res.setHeader('RateLimit-Reset', Math.ceil(entry.resetAt / 1000));

    if (entry.count <= max) {
      next();
      return;
    }

    console.warn(JSON.stringify({
      event: 'rate_limit_exceeded',
      requestId: req.requestId,
      limiter: name,
      path: req.path,
    }));
    res.setHeader('Retry-After', Math.ceil((entry.resetAt - now) / 1000));
    res.status(429).json({
      error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' },
    });
  };
}
