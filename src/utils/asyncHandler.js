/**
 * ============================================================
 * CephasGM GameZone — Async Handler Wrapper
 * ============================================================
 * Express 4 doesn't catch errors thrown in async route handlers.
 * This wrapper catches them and forwards to next(err) so the
 * central errorHandler can process them.
 *
 * Usage:
 *   router.get('/x', asyncHandler(async (req, res) => { ... }));
 * ============================================================
 */

'use strict';

/**
 * @param {Function} fn — async (req, res, next) => Promise
 * @returns {Function} Express middleware
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = asyncHandler;