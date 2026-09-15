/**
 * ============================================================
 * CephasGM GameZone — Referral Controller
 * ============================================================
 */

'use strict';

const referralService = require('../services/referral.service');
const apiResponse = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');
const { AppError } = require('../utils/AppError');

/* GET /referrals/me — my referral code + summary */
const getMyCode = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');
  const result = await referralService.getMyCode(req.user.id);
  return apiResponse.ok(res, result);
});

/* GET /referrals — list my referrals */
const listMine = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');
  const result = await referralService.listMyReferrals(req.user.id, req.query);
  return apiResponse.paginated(res, result.items, result.pagination);
});

module.exports = {
  getMyCode,
  listMine,
};