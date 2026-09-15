/**
 * ============================================================
 * CephasGM GameZone — Bonus Service
 * ============================================================
 * Handles:
 *   • listAvailable()   — bonuses user can claim
 *   • claim()           — claim by code, credit bonusBalance
 *   • listMine()        — my claimed bonuses + wager progress
 *   • applyWager()      — track wager requirement as user bets
 *   • expireStale()     — background job hook
 *
 * Wager rule: a bonus with wagerMultiplier=5 means the user
 * must wager 5× the bonus amount before it can be withdrawn.
 * When fully wagered, bonusBalance converts to real balance.
 * ============================================================
 */

'use strict';

const Decimal = require('decimal.js');

const prisma = require('../config/database');
const logger = require('../config/logger');
const { AppError } = require('../utils/AppError');
const walletService = require('./wallet.service');
const { generateRef } = require('../utils/generateRef');

/* ============================================================
   LIST AVAILABLE
   ============================================================ */
async function listAvailable(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError('User not found', 404, 'USER_NOT_FOUND');

  /* Already-claimed bonuses */
  const claimed = await prisma.userBonus.findMany({
    where: { userId, status: { in: ['ACTIVE', 'USED'] } },
    select: { bonusId: true },
  });
  const claimedIds = claimed.map((c) => c.bonusId);

  /* Public, active bonuses not yet claimed */
  const bonuses = await prisma.bonus.findMany({
    where: {
      active: true,
      isPublic: true,
      id: { notIn: claimedIds },
      OR: [
        { validUntil: null },
        { validUntil: { gt: new Date() } },
      ],
    },
    orderBy: { createdAt: 'desc' },
  });

  return bonuses.map(publicBonus);
}

/* ============================================================
   CLAIM
   ============================================================ */
async function claim(userId, code) {
  const bonus = await prisma.bonus.findUnique({ where: { code } });
  if (!bonus) throw new AppError('Invalid bonus code', 404, 'BONUS_NOT_FOUND');
  if (!bonus.active) throw new AppError('Bonus is not active', 400, 'BONUS_INACTIVE');
  if (bonus.validUntil && bonus.validUntil < new Date()) {
    throw new AppError('Bonus has expired', 400, 'BONUS_EXPIRED');
  }

  /* Already claimed? */
  const existing = await prisma.userBonus.findFirst({
    where: { userId, bonusId: bonus.id, status: { in: ['ACTIVE', 'USED'] } },
  });
  if (existing) {
    throw new AppError('You already claimed this bonus', 409, 'ALREADY_CLAIMED');
  }

  /* Bonuses with minDeposit require a completed deposit */
  if (bonus.minDeposit && Number(bonus.minDeposit) > 0) {
    const totalDeposited = await prisma.user.findUnique({
      where: { id: userId },
      select: { totalDeposited: true },
    });
    if (new Decimal(totalDeposited?.totalDeposited || 0).lessThan(bonus.minDeposit)) {
      throw new AppError(
        `You need to deposit at least ${bonus.minDeposit} to claim this bonus`,
        400,
        'MIN_DEPOSIT_NOT_MET'
      );
    }
  }

  const amount = new Decimal(bonus.amount);
  const wagerRequired = amount.mul(bonus.wagerMultiplier);
  const expiresAt = bonus.validUntil || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

  /* Create UserBonus + credit bonusBalance in a transaction */
  const result = await prisma.$transaction(async (tx) => {
    const userBonus = await tx.userBonus.create({
      data: {
        userId,
        bonusId: bonus.id,
        amount: amount.toString(),
        wagerRequired: wagerRequired.toString(),
        expiresAt,
        status: 'ACTIVE',
      },
    });

    /* Credit bonusBalance (separate from real balance) */
    await walletService.credit(userId, amount.toString(), {
      type: 'BONUS_CREDIT',
      description: `Bonus claimed: ${bonus.name}`,
      reference: generateRef('TXN'),
      bonusId: bonus.id,
      useBonus: true, // credits bonusBalance
    });

    return userBonus;
  });

  logger.info(
    { userId, bonusId: bonus.id, amount: amount.toString(), wager: wagerRequired.toString() },
    '🎁 Bonus claimed'
  );

  return {
    id: result.id,
    bonusId: bonus.id,
    code: bonus.code,
    name: bonus.name,
    amount: amount.toString(),
    wagerRequired: wagerRequired.toString(),
    wagerCompleted: '0',
    status: result.status,
    expiresAt: result.expiresAt,
  };
}

/* ============================================================
   LIST MINE
   ============================================================ */
async function listMine(userId, { page = 1, limit = 20, status } = {}) {
  const skip = (page - 1) * limit;
  const where = { userId };
  if (status) where.status = status;

  const [items, total] = await Promise.all([
    prisma.userBonus.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: { bonus: { select: { code: true, name: true, type: true } } },
    }),
    prisma.userBonus.count({ where }),
  ]);

  return {
    items: items.map((b) => ({
      id: b.id,
      bonusCode: b.bonus?.code,
      bonusName: b.bonus?.name,
      bonusType: b.bonus?.type,
      amount: b.amount.toString(),
      amountUsed: b.amountUsed.toString(),
      wagerRequired: b.wagerRequired.toString(),
      wagerCompleted: b.wagerCompleted.toString(),
      status: b.status,
      expiresAt: b.expiresAt,
      createdAt: b.createdAt,
    })),
    pagination: { page, limit, total },
  };
}

/* ============================================================
   APPLY WAGER
   ------------------------------------------------------------
   Called whenever a user places a bet, to advance wager progress
   on any ACTIVE bonus. When fully wagered → convert bonusBalance
   to real balance (release the bonus).
   ============================================================ */
async function applyWager(userId, stakeAmount) {
  const stake = new Decimal(stakeAmount);
  if (stake.lte(0)) return;

  const activeBonuses = await prisma.userBonus.findMany({
    where: { userId, status: 'ACTIVE' },
  });

  for (const ub of activeBonuses) {
    const required = new Decimal(ub.wagerRequired);
    const completed = new Decimal(ub.wagerCompleted);
    const remaining = required.minus(completed);

    if (remaining.lte(0)) continue;

    const applied = Decimal.min(stake, remaining);
    const newCompleted = completed.plus(applied);
    const fullyWagered = newCompleted.gte(required);

    await prisma.userBonus.update({
      where: { id: ub.id },
      data: {
        wagerCompleted: newCompleted.toString(),
        status: fullyWagered ? 'USED' : 'ACTIVE',
        usedAt: fullyWagered ? new Date() : null,
      },
    });

    /* If fully wagered: transfer bonusBalance → real balance */
    if (fullyWagered) {
      const bonusAmount = new Decimal(ub.amount);

      /* Debit bonusBalance, credit real balance */
      await prisma.$transaction(async (tx) => {
        await tx.wallet.updateMany({
          where: { userId },
          data: { bonusBalance: { decrement: bonusAmount.toString() } },
        });
        await tx.wallet.updateMany({
          where: { userId },
          data: { balance: { increment: bonusAmount.toString() } },
        });

        await tx.transaction.create({
          data: {
            userId,
            type: 'BONUS_CREDIT',
            status: 'COMPLETED',
            amount: bonusAmount.toString(),
            balanceBefore: '0',
            balanceAfter: '0',
            currency: 'TZS',
            reference: generateRef('TXN'),
            description: `Bonus wagered — released to real balance`,
          },
        });
      });

      logger.info(
        { userId, bonusId: ub.bonusId, amount: bonusAmount.toString() },
        '🎁 Bonus fully wagered — funds released'
      );
    }
  }
}

/* ============================================================
   PUBLIC SHAPE
   ============================================================ */
function publicBonus(b) {
  return {
    id: b.id,
    code: b.code,
    name: b.name,
    description: b.description,
    type: b.type,
    amount: b.amount.toString(),
    percentage: b.percentage ? b.percentage.toString() : null,
    maxAmount: b.maxAmount ? b.maxAmount.toString() : null,
    minDeposit: b.minDeposit ? b.minDeposit.toString() : null,
    wagerMultiplier: b.wagerMultiplier.toString(),
    maxBetAmount: b.maxBetAmount ? b.maxBetAmount.toString() : null,
    validUntil: b.validUntil,
  };
}

module.exports = {
  listAvailable,
  claim,
  listMine,
  applyWager,
  publicBonus,
};