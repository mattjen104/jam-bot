import type { RequestHandler, ErrorRequestHandler } from "express";

/** Wraps an async route handler; any thrown error is forwarded to next(). */
export function h(fn: RequestHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Typed HTTP error. Throw this from inside an h()-wrapped handler to control
 * the response status code and message from the centralized error middleware.
 */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/**
 * Centralized error middleware for the lore router. Mount once in app.ts after
 * the router so every unhandled async error lands here instead of crashing.
 */
export const loreErrorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const status = err instanceof HttpError ? err.status : 503;
  const message =
    err instanceof HttpError ? err.message : "Internal error";
  console.error(`[lore] ${req.method} ${req.path} failed`, err);
  res.status(status).json({ error: message });
};
