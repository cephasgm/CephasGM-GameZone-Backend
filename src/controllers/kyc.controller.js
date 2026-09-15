/**
 * ============================================================
 * CephasGM GameZone — KYC Controller
 * ============================================================
 */

'use strict';

const kycService = require('../services/kyc.service');
const apiResponse = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');
const { AppError } = require('../utils/AppError');

/* POST /kyc — submit documents */
const submit = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');
  const docs = await kycService.submit(req.user.id, req.body);
  return apiResponse.created(res, docs, 'KYC submitted for review');
});

/* GET /kyc/me — my KYC status + docs */
const getMyStatus = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');
  const status = await kycService.getMyStatus(req.user.id);
  return apiResponse.ok(res, status);
});

/* POST /kyc/:userId/review — admin */
const review = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');
  const result = await kycService.review(req.user.id, req.params.userId, req.body);
  return apiResponse.ok(res, result, `KYC ${req.body.status.toLowerCase()}`);
});

module.exports = {
  submit,
  getMyStatus,
  review,
};