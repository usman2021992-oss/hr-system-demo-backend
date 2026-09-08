import { Request, Response, NextFunction } from 'express';

type AsyncRouteHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<any>;

/**
 * Wraps an async Express route handler so that any unhandled promise rejection
 * is forwarded to Express's error handler via next(err).
 *
 * Express 4 does NOT catch async errors automatically — without this wrapper,
 * a thrown DB error would cause the request to hang indefinitely.
 */
export function asyncHandler(fn: AsyncRouteHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}
