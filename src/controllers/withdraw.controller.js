/**
 * ============================================================
 * CephasGM GameZone — Withdraw Controller
 * ============================================================
 */

'use strict';

const withdrawService = require('../services/withdraw.service');
const apiResponse = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');
const { AppError } = require('../utils/AppError');

/* POST /withdrawals — request a payout (KYC required) */
const request = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');

  const withdrawal = await withdrawService.request(req.user.id, req.body);
  return apiResponse.created(res, withdrawal, 'Withdrawal requested — awaiting review');
});

/* GET /withdrawals — list user's withdrawals */
const list = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');

  const result = await withdrawService.list(req.user.id, req.query);
  return apiResponse.paginated(res, result.items, {
    page: result.pagination.page,
    limit: result.pagination.limit,
    total: result.pagination.total,
  });
});

/* GET /withdrawals/:reference — one withdrawal */
const getOne = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');

  const withdrawal = await withdrawService.getOne(req.user.id, req.params.reference);
  return apiResponse.ok(res, withdrawal);
});

/* ---------- ADMIN-ONLY ---------- */

/* POST /withdrawals/:reference/approve */
const approve = asyncHandler(async (req, res) => {
  const withdrawal = await withdrawService.approve(
    req.user.id,
    req.params.reference,
    req.body.note
  );
  return apiResponse.ok(res, withdrawal, 'Withdrawal approved');
});

/* POST /withdrawals/:reference/reject */
const reject = asyncHandler(async (req, res) => {
  const withdrawal = await withdrawService.reject(
    req.user.id,
    req.params.reference,
    req.body.reason
  );
  return apiResponse.ok(res, withdrawal, 'Withdrawal rejected — funds returned');
});

/* POST /withdrawals/webhook/:provider */
const webhook = asyncHandler(async (req, res) => {
  const result = await withdrawService.handleWebhook(req.params.provider, req);
  return apiResponse.ok(res, result);
});

module.exports = {
  request,
  list,
  getOne,
  approve,
  reject,
  webhook,
};