import { randomUUID } from 'crypto';
import { type Request, type Response, type NextFunction } from 'express';

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

/** Adds a safe correlation ID without recording request bodies or credentials. */
export function requestContext(req: Request, res: Response, next: NextFunction): void {
  // Reject unbounded/client-controlled correlation tokens in logs and headers.
  const supplied = req.get('x-request-id');
  const requestId = supplied && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(supplied)
    ? supplied : randomUUID();
  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);

  res.on('finish', () => {
    console.info(JSON.stringify({
      event: 'http_request_complete',
      requestId,
      method: req.method,
      route: typeof req.route?.path === 'string' ? req.route.path : 'unmatched',
      status: res.statusCode,
    }));
  });

  next();
}
