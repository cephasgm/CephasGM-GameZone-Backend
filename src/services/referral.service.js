/**
 * ============================================================
 * CephasGM GameZone — Referral Service
 * ============================================================
 * Handles:
 *   • getMyCode()      — user's referral code + stats
 *   • listMyReferrals()— who I referred + how much they've bet
 *   • creditCommission()— called when a referred user places a bet
 *
 * Commission rule (config.referrals.commissionPercent):
 *   When a referred user places a bet, we credit the referrer
 *   5% of the stake, immediately.
 * ============================================================
 */

'use strict';

const Decimal = require('decimal.js');

const config = require('../config');
const prisma = require('../config/database');
const logger = require('../config/logger');
const { AppError } = require('../utils/AppError');
const walletService = require('./wallet.service');
const { generateRef } = require('../utils/generateRef');

/* ============================================================
   GET MY CODE + SUMMARY
   ============================================================ */
async function getMyCode(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { referralCode: true, referredById: true },
  });
  if (!user) throw new AppError('User not found', 404, 'USER_NOT_FOUND');

  const [referralCount, totalCommission, referrals] = await Promise.all([
    prisma.referral.count({ where: { referrerId: userId } }),
    prisma.referral.aggregate({
      where: { referrerId: userId },
      _sum: { commissionEarned: true, totalReferredBets: true },
    }),
    prisma.referral.findMany({
      where: { referrerId: userId },
      include: {
        referred: {
          select: { id: true, username: true, fullName: true, createdAt: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
  ]);

  return {
    referralCode: user.referralCode,
    shareUrl: `${config.frontendUrl}/signup.html?ref=${user.referralCode}`,
    totalReferrals: referralCount,
    totalCommissionEarned: (totalCommission._sum.commissionEarned || 0).toString(),
    totalReferredBets: (totalCommission._sum.totalReferredBets || 0).toString(),
    commissionPercent: config.referrals.commissionPercent,
    recentReferrals: referrals.map((r) => ({
      id: r.id,
      referredUsername: r.referred.username,
      referredName: r.referred.fullName,
      referredAt: r.referred.createdAt,
      commissionEarned: r.commissionEarned.toString(),
    })),
  };
}

/* ============================================================
   LIST REFERRALS
   ============================================================ */
async function listMyReferrals(userId, { page = 1, limit = 20 } = {}) {
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    prisma.referral.findMany({
      where: { referrerId: userId },
      include: {
        referred: {
          select: { id: true, username: true, fullName: true, createdAt: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.referral.count({ where: { referrerId: userId } }),
  ]);

  return {
    items: items.map((r) => ({
      id: r.id,
      referredId: r.referred.id,
      referredUsername: r.referred.username,
      referredName: r.referred.fullName,
      referredAt: r.referred.createdAt,
      commissionEarned: r.commissionEarned.toString(),
      totalReferredBets: r.totalReferredBets.toString(),
      isActive: r.isActive,
    })),
    pagination: { page, limit, total },
  };
}

/* ============================================================
   CREDIT COMMISSION
   ------------------------------------------------------------
   Called by the bet service every time a bet is placed.
   Finds the referrer of the bettor (if any) and credits
   commission = stake * commissionPercent / 100.
   ============================================================ */
async function creditCommission(bettorId, stakeAmount) {
  const stake = new Decimal(stakeAmount);
  if (stake.lte(0)) return null;

  /* Is this user referred by someone? */
  const referral = await prisma.referral.findFirst({
    where: { referredId: bettorId, isActive: true },
    include: { referrer: { select: { id: true, status: true } } },
  });

  if (!referral) return null;
  if (referral.referrer.status !== 'ACTIVE') return null;

  const commissionRate = new Decimal(config.referrals.commissionPercent).div(100);
  const commission = stake.mul(commissionRate).toDecimalPlaces(2);

  if (commission.lte(0)) return null;

  /* Credit referrer's wallet with real balance */
  await walletService.credit(referral.referrer.id, commission.toString(), {
    type: 'REFERRAL_COMMISSION',
    description: `Referral commission from bet by user ${bettorId}`,
    reference: generateRef('TXN'),
    referralId: referral.id,
  });

  /* Update the referral ledger */
  await prisma.referral.update({
    where: { id: referral.id },
    data: {
      commissionEarned: { increment: commission.toString() },
      totalReferredBets: { increment: stake.toString() },
    },
  });

  logger.info(
    {
      referrerId: referral.referrer.id,
      bettorId,
      stake: stake.toString(),
      commission: commission.toString(),
    },
    '💸 Referral commission credited'
  );

  return { commission: commission.toString() };
}

module.exports = {
  getMyCode,
  listMyReferrals,
  creditCommission,
};