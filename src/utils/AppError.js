/**
 * ============================================================
 * CephasGM GameZone — AppError
 * ============================================================
 * Custom error class carrying an HTTP status code and a
 * machine-readable error code. Throw these anywhere in the app
 * and the central errorHandler turns them into a clean JSON
 * response.
 *
 * Usage:
 *   throw new AppError('Insufficient balance', 400, 'INSUFFICIENT_BALANCE');
 *   throw new AppError('Email already registered', 409, 'EMAIL_TAKEN');
 *   throw AppError.notFound('User');
 *   throw AppError.unauthorized();
 * ============================================================
 */

'use strict';

class AppError extends Error {
  /**
   * @param {string} message   Human-readable message (safe to show the user)
   * @param {number} statusCode HTTP status (default 400)
   * @param {string} code      Machine-readable code (optional)
   * @param {object} meta      Extra data (validation errors, etc.)
   */
  constructor(message, statusCode = 400, code = null, meta = null) {
    super(message);

    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code || defaultCode(statusCode);
    this.meta = meta;
    this.isOperational = true; // flag for errorHandler — don't log stack for these

    Error.captureStackTrace(this, this.constructor);
  }
}

/* ------------------------------------------------------------
   Map status codes to default error codes
   ------------------------------------------------------------ */
function defaultCode(statusCode) {
  switch (statusCode) {
    case 400: return 'BAD_REQUEST';
    case 401: return 'UNAUTHORIZED';
    case 403: return 'FORBIDDEN';
    case 404: return 'NOT_FOUND';
    case 409: return 'CONFLICT';
    case 422: return 'UNPROCESSABLE_ENTITY';
    case 429: return 'RATE_LIMITED';
    case 500: return 'INTERNAL_ERROR';
    case 502: return 'BAD_GATEWAY';
    case 503: return 'SERVICE_UNAVAILABLE';
    default:  return 'ERROR';
  }
}

/* ------------------------------------------------------------
   Static factory helpers — cleaner call sites
   ------------------------------------------------------------ */

AppError.badRequest = (message = 'Bad request', code, meta) =>
  new AppError(message, 400, code, meta);

AppError.unauthorized = (message = 'Authentication required', code, meta) =>
  new AppError(message, 401, code, meta);

AppError.forbidden = (message = 'Access denied', code, meta) =>
  new AppError(message, 403, code, meta);

AppError.notFound = (resource, code, meta) =>
  new AppError(
    resource ? `${resource} not found` : 'Resource not found',
    404,
    code || 'NOT_FOUND',
    meta
  );

AppError.conflict = (message = 'Resource conflict', code, meta) =>
  new AppError(message, 409, code, meta);

AppError.unprocessable = (message = 'Unprocessable entity', code, meta) =>
  new AppError(message, 422, code, meta);

AppError.tooMany = (message = 'Too many requests', code, meta) =>
  new AppError(message, 429, code, meta);

AppError.internal = (message = 'Something went wrong', code, meta) =>
  new AppError(message, 500, code, meta);

module.exports = { AppError };