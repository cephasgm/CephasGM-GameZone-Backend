/**
 * ============================================================
 * CephasGM GameZone — Wallet Controller
 * ============================================================
 */

'use strict';

const walletService = require('../services/wallet.service');
const apiResponse = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');
const { AppError } = require('../utils/AppError');

/* GET /wallet — balance summary */
const getWallet = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');
  const wallet = await walletService.getBalance(req.user.id, req.query.currency);
  return apiResponse.ok(res, wallet);
});

/* GET /wallet/balance — same as getWallet, shorter alias */
const getBalance = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');
  const wallet = await walletService.getBalance(req.user.id, req.query.currency);
  return apiResponse.ok(res, { balance: wallet.balance, currency: wallet.currency });
});

/* GET /wallet/wallets — list all wallets for the user */
const listWallets = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');
  const user = await req.app.get('prisma').user.findUnique({
    where: { id: req.user.id },
    include: { wallets: true },
  });
  return apiResponse.ok(res, user.wallets);
});

module.exports = {
  getWallet,
  getBalance,
  listWallets,
};