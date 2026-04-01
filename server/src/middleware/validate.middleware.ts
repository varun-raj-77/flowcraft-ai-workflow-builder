import { type Request, type Response, type NextFunction } from 'express';
import { type ZodSchema, ZodError } from 'zod';

/**
 * Creates an Express middleware that validates req.body against a Zod schema.
 * On success: attaches parsed data to req.body (with defaults applied).
 * On failure: returns 400 with structured error details.
 */
export function validateBody(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const details = formatZodErrors(result.error);
      // Use the first specific error as the message so the frontend can display it directly
      const firstError = details[0];
      const message = firstError
        ? `${firstError.field ? firstError.field + ': ' : ''}${firstError.message}`
        : 'Request body validation failed';

      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message,
          details,
        },
      });
      return;
    }

    req.body = result.data;
    next();
  };
}

/**
 * Creates an Express middleware that validates req.params against a Zod schema.
 */
export function validateParams(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.params);

    if (!result.success) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request parameters validation failed',
          details: formatZodErrors(result.error),
        },
      });
      return;
    }

    next();
  };
}

/**
 * Formats ZodError into a clean array of field-level error messages.
 */
function formatZodErrors(error: ZodError): Array<{ field: string; message: string }> {
  return error.issues.map((issue) => ({
    field: issue.path.join('.'),
    message: issue.message,
  }));
}
