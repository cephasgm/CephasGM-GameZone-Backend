/**
 * ============================================================
 * CephasGM GameZone — Central Error Handler
 * ============================================================
 * Every error thrown (via next(err) or await throw) lands here.
 * Turns them into a consistent JSON response and decides what
 * to log and how loudly.
 *
 * Express identifies error handlers by their 4-argument
 * signature — this file MUST have (err, req, res, next).
 * ============================================================
 */

'use strict';

const { Prisma } = require('@prisma/client');
const { ZodError } = require('zod');

const config = require('../config');
const logger = require('../config/logger');
const { AppError } = require('../utils/AppError');

/* ------------------------------------------------------------
   Map known non-AppError classes to AppErrors
   ------------------------------------------------------------ */
function normaliseError(err) {
  // Already an AppError → pass through
  if (err instanceof AppError) return err;

  // Zod errors (in case validate middleware is bypassed)
  if (err instanceof ZodError) {
    return new AppError('Validation failed', 422, 'VALIDATION_ERROR', err.issues);
  }

  // Prisma known errors
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    return mapPrismaError(err);
  }

  if (err instanceof Prisma.PrismaClientValidationError) {
    return new AppError('Invalid data provided', 400, 'DB_VALIDATION_ERROR');
  }

  if (err instanceof Prisma.PrismaClientInitializationError) {
    return new AppError('Database unavailable', 503, 'DB_UNAVAILABLE');
  }

  if (err instanceof Prisma.PrismaClientRustPanicError) {
    return new AppError('Database engine crashed', 500, 'DB_PANIC');
  }

  // JWT errors (belt & suspenders — auth.js usually catches them)
  if (err.name === 'JsonWebTokenError') {
    return new AppError('Invalid token', 401, 'TOKEN_INVALID');
  }
  if (err.name === 'TokenExpiredError') {
    return new AppError('Token expired', 401, 'TOKEN_EXPIRED');
  }

  // Multer upload errors
  if (err.name === 'MulterError') {
    return new AppError(`Upload failed: ${err.message}`, 400, 'UPLOAD_ERROR');
  }

  // CORS rejection from app.js
  if (err.message === 'Not allowed by CORS') {
    return new AppError('Origin not allowed', 403, 'CORS_REJECTED');
  }

  // Fallback — unknown error
  return new AppError(
    config.isProd ? 'Something went wrong' : err.message || 'Unknown error',
    500,
    'INTERNAL_ERROR'
  );
}

/* ------------------------------------------------------------
   Prisma error code → HTTP mapping
   ------------------------------------------------------------ */
function mapPrismaError(err) {
  switch (err.code) {
    case 'P2000':
      return new AppError('Value too long for field', 400, 'FIELD_TOO_LONG');
    case 'P2001':
      return new AppError('Record does not exist', 404, 'RECORD_NOT_FOUND');
    case 'P2002': {
      const field = err.meta?.target?.[0] || 'field';
      return new AppError(
        `This ${field} is already in use`,
        409,
        'UNIQUE_CONSTRAINT',
        { field }
      );
    }
    case 'P2003':
      return new AppError('Foreign key constraint failed', 400, 'FK_CONSTRAINT');
    case 'P2004':
      return new AppError('Constraint failed on the database', 400, 'DB_CONSTRAINT');
    case 'P2011':
      return new AppError('Required field is null', 400, 'NULL_CONSTRAINT');
    case 'P2014':
      return new AppError('Relation violation', 400, 'RELATION_VIOLATION');
    case 'P2025':
      return new AppError('Record not found', 404, 'RECORD_NOT_FOUND');
    case 'P2034':
      return new AppError(
        'Transaction conflict — please retry',
        409,
        'TRANSACTION_CONFLICT'
      );
    default:
      logger.error({ prismaCode: err.code, meta: err.meta }, 'Unmapped Prisma error');
      return new AppError('Database error', 500, 'DB_ERROR');
  }
}

/* ------------------------------------------------------------
   Main handler
   ------------------------------------------------------------ */
function errorHandler(err, req, res, _next) {
  const appErr = normaliseError(err);

  // Determine if this was an unexpected error (needs a stack trace)
  const isExpected = appErr.isOperational || err instanceof AppError;
  const statusCode = appErr.statusCode || 500;

  // Log — quiet on expected 4xx, loud on 5xx
  if (statusCode >= 500) {
    logger.error(
      {
        err: {
          name: err.name,
          message: err.message,
          stack: err.stack,
          code: appErr.code,
        },
        method: req.method,
        path: req.originalUrl,
        userId: req.user?.id,
        ip: req.ip,
      },
      `❌ ${req.method} ${req.originalUrl} → ${statusCode} ${appErr.code}`
    );
  } else if (!isExpected || config.isDev) {
    logger.warn(
      {
        method: req.method,
        path: req.originalUrl,
        userId: req.user?.id,
        code: appErr.code,
      },
      `⚠️  ${req.method} ${req.originalUrl} → ${statusCode} ${appErr.code}`
    );
  }

  // Build response
  const response = {
    success: false,
    message: appErr.message || 'Something went wrong',
    code: appErr.code || 'ERROR',
  };

  // Include field-level validation errors if present
  if (appErr.meta) {
    response.errors = appErr.meta;
  }

  // Include stack trace only in dev for 5xx errors
  if (config.isDev && statusCode >= 500 && err.stack) {
    response.stack = err.stack.split('\n').slice(0, 8);
  }

  res.status(statusCode).json(response);
}

module.exports = errorHandler;