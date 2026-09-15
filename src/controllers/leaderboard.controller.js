/**
 * ============================================================
 * CephasGM GameZone — Leaderboard Controller
 * ============================================================
 */

'use strict';

const leaderboardService = require('../services/leaderboard.service');
const apiResponse = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');
const { AppError } = require('../utils/AppError');

const getTop = asyncHandler(async (req, res) => {
  const rows = await leaderboardService.getTop(req.query);
  return apiResponse.ok(res, {
    period: req.query.period || 'weekly',
    metric: req.query.metric || 'winnings',
    leaders: rows,
  });
});

const getMine = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');
  const row = await leaderboardService.getMyRank(req.user.id, req.query);
  return apiResponse.ok(res, row);
});

module.exports = { getTop, getMine };