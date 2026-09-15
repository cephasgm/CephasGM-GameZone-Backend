/**
 * ============================================================
 * CephasGM GameZone — 404 Handler
 * ============================================================
 * Reached when no route matched. Turns an unmatched request
 * into a clean JSON response instead of Express's default
 * HTML page.
 * ============================================================
 */

'use strict';

const { AppError } = require('../utils/AppError');

function notFound(req, res, next) {
  next(
    new AppError(
      `Route ${req.method} ${req.originalUrl} not found`,
      404,
      'ROUTE_NOT_FOUND'
    )
  );
}

module.exports = notFound;