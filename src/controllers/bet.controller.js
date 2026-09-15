/**
 * ============================================================
 * CephasGM GameZone — Bet Controller
 * ============================================================
 */

'use strict';

const betService = require('../services/bet.service');
const apiResponse = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');
const { AppError } = require('../utils/AppError');

/* POST /bets — place a bet */
const place = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');
  const bet = await betService.place(req.user.id, req.body);
  return apiResponse.created(res, bet, 'Bet placed successfully');
});

/* GET /bets — list user's bets */
const list = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');
  const result = await betService.list(req.user.id, req.query);
  return apiResponse.paginated(res, result.items, {
    page: result.pagination.page,
    limit: result.pagination.limit,
    total: result.pagination.total,
  });
});

/* GET /bets/:reference */
const getOne = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');
  const bet = await betService.getOne(req.user.id, req.params.reference);
  return apiResponse.ok(res, bet);
});

/* GET /bets/:reference/cashout-quote */
const cashoutQuote = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');
  const quote = await betService.getCashoutQuote(req.user.id, req.params.reference);
  return apiResponse.ok(res, quote);
});

/* POST /bets/:reference/cashout */
const cashOut = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');
  const bet = await betService.cashOut(req.user.id, req.params.reference);
  return apiResponse.ok(res, bet, 'Bet cashed out');
});

module.exports = {
  place,
  list,
  getOne,
  cashoutQuote,
  cashOut,
};