/**
 * ============================================================
 * CephasGM GameZone — API Response Helpers
 * ============================================================
 * Every successful response flows through one of these helpers
 * so the frontend always sees the same shape:
 *
 *   {
 *     success: true,
 *     message?: string,
 *     data?: any,
 *     meta?: { pagination }
 *   }
 *
 * Usage in controllers:
 *   return apiResponse.ok(res, user, 'Login successful');
 *   return apiResponse.created(res, bet);
 *   return apiResponse.paginated(res, items, { page, limit, total });
 * ============================================================
 */

'use strict';

/**
 * 200 OK with optional data + message.
 */
function ok(res, data = null, message = null) {
  const body = { success: true };
  if (message) body.message = message;
  if (data !== null && data !== undefined) body.data = data;
  return res.status(200).json(body);
}

/**
 * 201 Created — for POST that creates a resource.
 */
function created(res, data = null, message = null) {
  const body = { success: true };
  if (message) body.message = message;
  if (data !== null && data !== undefined) body.data = data;
  return res.status(201).json(body);
}

/**
 * 204 No Content — for successful DELETE with nothing to return.
 */
function noContent(res) {
  return res.status(204).send();
}

/**
 * Paginated response — wraps an array with pagination meta.
 * @param {object} res
 * @param {array} items
 * @param {object} pagination — { page, limit, total }
 */
function paginated(res, items, pagination = {}) {
  const page = Number(pagination.page) || 1;
  const limit = Number(pagination.limit) || 20;
  const total = Number(pagination.total) || items.length;
  const totalPages = Math.ceil(total / limit);

  return res.status(200).json({
    success: true,
    data: items,
    meta: {
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    },
  });
}

/**
 * Error response — normally thrown as AppError and handled by
 * errorHandler, but exposed for special cases where a controller
 * needs to respond directly (e.g. webhooks).
 */
function error(res, message, statusCode = 400, code = null, meta = null) {
  const body = {
    success: false,
    message: message || 'Something went wrong',
    code: code || 'ERROR',
  };
  if (meta) body.errors = meta;
  return res.status(statusCode).json(body);
}

module.exports = {
  ok,
  created,
  noContent,
  paginated,
  error,
};