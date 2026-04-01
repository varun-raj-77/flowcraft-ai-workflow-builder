import { type Request, type Response, type NextFunction } from 'express';

/**
 * Wraps an async route handler to catch errors and forward to Express error middleware.
 * Without this, unhandled promise rejections from async handlers silently hang.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}
