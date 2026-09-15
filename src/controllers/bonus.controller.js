/**
 * ============================================================
 * CephasGM GameZone — Bonus Controller
 * ============================================================
 */

'use strict';

const bonusService = require('../services/bonus.service');
const apiResponse = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');
const { AppError } = require('../utils/AppError');

/* GET /bonuses — available bonuses for the user */
const listAvailable = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');
  const items = await bonusService.listAvailable(req.user.id);
  return apiResponse.ok(res, items);
});

/* POST /bonuses/claim — claim by code */
const claim = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');
  const result = await bonusService.claim(req.user.id, req.body.code);
  return apiResponse.created(res, result, 'Bonus claimed successfully');
});

/* GET /bonuses/mine — my claimed bonuses */
const listMine = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');
  const result = await bonusService.listMine(req.user.id, req.query);
  return apiResponse.paginated(res, result.items, result.pagination);
});

module.exports = {
  listAvailable,
  claim,
  listMine,
};