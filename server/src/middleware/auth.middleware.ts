import { type Request, type Response, type NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { verifyToken } from '../utils/jwt';

// Extend Express Request to include userId
declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

/**
 * Middleware that verifies the JWT from the 'token' cookie.
 * On success: attaches req.userId.
 * On failure: returns 401.
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.token;

  if (!token) {
    rejectAuthentication(req, res, 'MISSING_TOKEN', 'Authentication required');
    return;
  }

  try {
    const payload = verifyToken(token);
    req.userId = payload.userId;
    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      rejectAuthentication(req, res, 'TOKEN_EXPIRED', 'Your session has expired. Please sign in again.');
      return;
    }
    rejectAuthentication(req, res, 'INVALID_TOKEN', 'Invalid authentication token');
  }
}

function rejectAuthentication(
  req: Request,
  res: Response,
  code: 'MISSING_TOKEN' | 'TOKEN_EXPIRED' | 'INVALID_TOKEN',
  message: string,
): void {
  console.warn(JSON.stringify({
    event: 'authentication_failed',
    requestId: req.requestId,
    code,
    path: req.path,
  }));
  res.status(401).json({ error: { code, message } });
}
