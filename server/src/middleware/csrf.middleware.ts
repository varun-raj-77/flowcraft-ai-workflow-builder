import { type Request, type Response, type NextFunction } from 'express';
import { env } from '../config/environment';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Defends cookie-authenticated mutations even when CORS is bypassed.
 * Browser traffic to the first-party proxy always carries the UI origin.
 */
export function requireTrustedOrigin(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  const origin = req.get('origin');
  if (origin && env.TRUSTED_ORIGINS.includes(origin)) {
    next();
    return;
  }

  console.warn(JSON.stringify({
    event: 'csrf_origin_rejected',
    requestId: req.requestId,
    origin: origin || 'missing',
    path: req.path,
  }));
  res.status(403).json({
    error: { code: 'UNTRUSTED_ORIGIN', message: 'Request origin is not allowed.' },
  });
}
