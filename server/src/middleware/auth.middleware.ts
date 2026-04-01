import { type Request, type Response, type NextFunction } from 'express';
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
    res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
    });
    return;
  }

  try {
    const payload = verifyToken(token);
    req.userId = payload.userId;
    next();
  } catch {
    res.status(401).json({
      error: { code: 'INVALID_TOKEN', message: 'Invalid or expired token' },
    });
  }
}
