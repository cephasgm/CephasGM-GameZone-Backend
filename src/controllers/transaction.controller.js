/**
 * ============================================================
 * CephasGM GameZone — Transaction Controller
 * ============================================================
 */

'use strict';

const transactionService = require('../services/transaction.service');
const apiResponse = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');
const { AppError } = require('../utils/AppError');

/* GET /transactions — paginated list */
const list = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');

  const result = await transactionService.listTransactions(req.user.id, req.query);

  return apiResponse.paginated(
    res,
    result.items,
    {
      page: result.pagination.page,
      limit: result.pagination.limit,
      total: result.pagination.total,
    }
  );
});

/* GET /transactions/summary */
const summary = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');
  const data = await transactionService.getSummary(req.user.id, req.query);
  return apiResponse.ok(res, data);
});

/* GET /transactions/:reference */
const getOne = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');
  const txn = await transactionService.getByReference(req.user.id, req.params.reference);
  return apiResponse.ok(res, txn);
});

module.exports = {
  list,
  summary,
  getOne,
};