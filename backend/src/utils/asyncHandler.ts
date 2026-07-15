// asyncHandler — wraps an async Express route handler so that a
// rejected promise (e.g. a thrown domain error such as ValidationError,
// NotFoundError or ConflictError from services/errors.ts) is forwarded
// to `next`, allowing the central error-handling middleware
// (middleware/errorHandler.ts) to translate it into the standard API
// error response. Express 4 only catches synchronous throws
// automatically; async handlers must forward rejections explicitly.

import type { NextFunction, Request, Response } from 'express';

type AsyncRequestHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

export function asyncHandler(handler: AsyncRequestHandler) {
  return (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res, next).catch(next);
  };
}
