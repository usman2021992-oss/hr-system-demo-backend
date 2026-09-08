import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';
import { badRequest } from '../utils/response';

type RequestPart = 'body' | 'query' | 'params';

export function validate(schema: ZodSchema, part: RequestPart = 'body') {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[part]);
    if (!result.success) {
      const firstIssue = result.error.issues[0];
      const field = firstIssue.path.join('.');
      const message = field
        ? `Campo '${field}': ${firstIssue.message}`
        : firstIssue.message;
      badRequest(res, message, 'VALIDATION_ERROR');
      return;
    }
    req[part] = result.data;
    next();
  };
}
