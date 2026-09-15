/**
 * ============================================================
 * CephasGM GameZone — Deposit Controller
 * ============================================================
 */

'use strict';

const depositService = require('../services/deposit.service');
const payments = require('../services/payments');
const apiResponse = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');
const { AppError } = require('../utils/AppError');

/* GET /deposits/methods — list available payment methods */
const methods = asyncHandler(async (req, res) => {
  return apiResponse.ok(res, payments.availableMethods());
});

/* POST /deposits — initiate a deposit */
const initiate = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');

  const result = await depositService.initiate(req.user.id, req.body);

  return apiResponse.created(res, result, 'Deposit initiated');
});

/* GET /deposits — list user's deposits */
const list = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');

  const result = await depositService.list(req.user.id, req.query);

  return apiResponse.paginated(res, result.items, {
    page: result.pagination.page,
    limit: result.pagination.limit,
    total: result.pagination.total,
  });
});

/* GET /deposits/:reference — one deposit */
const getOne = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');

  const deposit = await depositService.getOne(req.user.id, req.params.reference);
  return apiResponse.ok(res, deposit);
});

/* GET /deposits/:reference/status — poll provider for latest status */
const checkStatus = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');

  const deposit = await depositService.checkStatus(req.user.id, req.params.reference);
  return apiResponse.ok(res, deposit);
});

/* POST /deposits/:reference/simulate — DEV ONLY — simulate a provider callback */
const simulate = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');

  const deposit = await depositService.simulateConfirm(req.user.id, req.params.reference);
  return apiResponse.ok(res, deposit, 'Simulated provider confirmation');
});

/* POST /deposits/webhook/:provider — provider callback (no auth) */
const webhook = asyncHandler(async (req, res) => {
  const result = await depositService.handleWebhook(req.params.provider, req);
  return apiResponse.ok(res, result);
});

module.exports = {
  methods,
  initiate,
  list,
  getOne,
  checkStatus,
  simulate,
  webhook,
};