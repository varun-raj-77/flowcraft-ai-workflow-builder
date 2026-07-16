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
  const requestId = req.get('x-request-id') || randomUUID();
  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);

  res.on('finish', () => {
    console.info(JSON.stringify({
      event: 'http_request_complete',
      requestId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
    }));
  });

  next();
}
