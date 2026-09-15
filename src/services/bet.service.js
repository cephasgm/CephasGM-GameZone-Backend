/**
 * ============================================================
 * CephasGM GameZone — Bet Service
 * ============================================================
 * Full bet lifecycle:
 *   1. place()      — validate, lock stake, create bet + selections
 *   2. settle()     — mark WON/LOST/VOID, credit or consume stake
 *   3. cashOut()    — early exit before settlement
 *   4. list / getOne — read-only
 *
 * Stake handling:
 *   • On placement: funds move from `balance` → `lockedBalance`
 *   • On WON:  lockedBalance consumed, winnings credited
 *   • On LOST: lockedBalance consumed, nothing credited
 *   • On VOID: lockedBalance unlocked back to balance
 *   • On CASHOUT: lockedBalance consumed, partial credit
 * ============================================================
 */

'use strict';

const Decimal = require('decimal.js');

const config = require('../config');
const logger = require('../config/logger');
const prisma = require('../config/database');
const { AppError } = require('../utils/AppError');
const { generateRef } = require('../utils/generateRef');
const walletService = require('./wallet.service');

/* ============================================================
   HELPERS
   ============================================================ */

function computeTotalOdds(selections) {
  return selections
    .reduce((acc, s) => acc.mul(s.odds || 1), new Decimal(1))
    .toDecimalPlaces(4);
}

function computePotentialWin(stake, totalOdds) {
  return new Decimal(stake).mul(totalOdds).toDecimalPlaces(2);
}

/* ============================================================
   PLACE BET
   ============================================================ */
async function place(userId, input) {
  const {
    type = 'SINGLE',
    stake,
    currency = null,
    selections,
    gameType = null,
    roundId = null,
    metadata = null,
  } = input;

  /* ---------- Validate ---------- */
  if (!Array.isArray(selections) || selections.length === 0) {
    throw new AppError('At least one selection is required', 400, 'NO_SELECTIONS');
  }
  if (type === 'SINGLE' && selections.length !== 1) {
    throw new AppError('A single bet must have exactly one selection', 400, 'INVALID_SELECTIONS');
  }
  if (type === 'MULTIPLE' && selections.length < 2) {
    throw new AppError('A multiple bet must have 2 or more selections', 400, 'INVALID_SELECTIONS');
  }

  // Validate each selection
  for (const s of selections) {
    if (!s.eventId || !s.selection || !s.odds) {
      throw new AppError('Each selection requires eventId, selection, and odds', 400, 'INVALID_SELECTION');
    }
    if (Number(s.odds) < 1.01) {
      throw new AppError(`Invalid odds: ${s.odds}`, 400, 'INVALID_ODDS');
    }
  }

  const stakeAmt = new Decimal(stake);
  if (stakeAmt.isNaN() || stakeAmt.lessThanOrEqualTo(0)) {
    throw new AppError('Stake must be positive', 400, 'INVALID_STAKE');
  }
  if (stakeAmt.lessThan(config.wallet.minBet)) {
    throw new AppError(`Minimum bet is ${config.wallet.minBet}`, 400, 'STAKE_BELOW_MIN');
  }
  if (stakeAmt.greaterThan(config.wallet.maxBet)) {
    throw new AppError(`Maximum bet is ${config.wallet.maxBet}`, 400, 'STAKE_ABOVE_MAX');
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError('User not found', 404, 'USER_NOT_FOUND');

  const targetCurrency = currency || user.currency || config.wallet.defaultCurrency;

  /* ---------- Compute odds + potential win ---------- */
  const totalOdds = computeTotalOdds(selections);
  const potentialWin = computePotentialWin(stakeAmt, totalOdds);
  const reference = generateRef('BET');

  /* ---------- Lock funds (own transaction) ---------- */
  await walletService.lockFunds(userId, stakeAmt.toString(), {
    reference: generateRef('TXN'),
    currency: targetCurrency,
  });

  /* ---------- Create bet + selections ---------- */
  let bet;
  try {
    bet = await prisma.bet.create({
      data: {
        userId,
        type,
        status: 'PENDING',
        stake: stakeAmt.toString(),
        totalOdds: totalOdds.toString(),
        potentialWin: potentialWin.toString(),
        currency: targetCurrency,
        reference,
        gameType,
        roundId,
        metadata: metadata || undefined,
        selections: {
          create: selections.map((s) => ({
            eventId: String(s.eventId),
            eventName: String(s.eventName || s.eventId),
            market: String(s.market || '1X2'),
            selection: String(s.selection),
            odds: new Decimal(s.odds).toString(),
            status: 'PENDING',
            eventStartAt: s.eventStartAt ? new Date(s.eventStartAt) : null,
          })),
        },
      },
      include: { selections: true },
    });
  } catch (err) {
    // Compensate: unlock funds because bet creation failed
    logger.error({ reference, err: err.message }, '❌ Bet creation failed — unlocking funds');
    await walletService.unlockFunds(userId, stakeAmt.toString(), { currency: targetCurrency }).catch(() => {});
    throw new AppError('Could not place bet. Please try again.', 500, 'BET_CREATE_FAILED');
  }

  // Bump user's totalWagered counter
  await prisma.user.update({
    where: { id: userId },
    data: { totalWagered: { increment: stakeAmt.toString() } },
  }).catch(() => {});

  logger.info(
    { userId, reference, stake: stakeAmt.toString(), odds: totalOdds.toString(), type },
    '🎯 Bet placed'
  );

  return publicBet(bet);
}

/* ============================================================
   SETTLE BET — system/admin calls this once the event finishes
   ------------------------------------------------------------
   @param {string} betId   — internal id (not reference)
   @param {string} result  — 'WON' | 'LOST' | 'VOID'
   @param {string} note    — optional settlement note
   ============================================================ */
async function settle(betId, result, note = null) {
  if (!['WON', 'LOST', 'VOID'].includes(result)) {
    throw new AppError('Invalid settlement result', 400, 'INVALID_RESULT');
  }

  const bet = await prisma.bet.findUnique({
    where: { id: betId },
    include: { selections: true },
  });
  if (!bet) throw new AppError('Bet not found', 404, 'BET_NOT_FOUND');
  if (bet.status !== 'PENDING') {
    throw new AppError(`Cannot settle — bet status is ${bet.status}`, 400, 'INVALID_STATE');
  }

  const stake = new Decimal(bet.stake);
  const payout = new Decimal(bet.potentialWin);

  /* ---------- WON ---------- */
  if (result === 'WON') {
    await walletService.creditWinnings(bet.userId, stake.toString(), payout.toString(), {
      betId: bet.id,
      reference: generateRef('TXN'),
      description: `Bet won: ${bet.reference}`,
      currency: bet.currency,
    });

    const updated = await prisma.bet.update({
      where: { id: bet.id },
      data: {
        status: 'WON',
        actualWin: payout.toString(),
        settledAt: new Date(),
        settledBy: note || 'system',
      },
      include: { selections: true },
    });

    // Update user's totalWon
    await prisma.user.update({
      where: { id: bet.userId },
      data: { totalWon: { increment: payout.toString() } },
    }).catch(() => {});

    logger.info({ reference: bet.reference, payout: payout.toString() }, '🏆 Bet won — winnings credited');
    return publicBet(updated);
  }

  /* ---------- LOST ---------- */
  if (result === 'LOST') {
    await walletService.consumeLocked(bet.userId, stake.toString(), {
      betId: bet.id,
      reference: generateRef('TXN'),
      description: `Bet lost: ${bet.reference}`,
      currency: bet.currency,
    });

    const updated = await prisma.bet.update({
      where: { id: bet.id },
      data: {
        status: 'LOST',
        actualWin: '0',
        settledAt: new Date(),
        settledBy: note || 'system',
      },
      include: { selections: true },
    });

    logger.info({ reference: bet.reference }, '❌ Bet lost');
    return publicBet(updated);
  }

  /* ---------- VOID (refund) ---------- */
  await walletService.unlockFunds(bet.userId, stake.toString(), { currency: bet.currency });

  const updated = await prisma.bet.update({
    where: { id: bet.id },
    data: {
      status: 'VOID',
      settledAt: new Date(),
      settledBy: note || 'system',
    },
    include: { selections: true },
  });

  logger.info({ reference: bet.reference }, '↩️  Bet voided — stake refunded');
  return publicBet(updated);
}

/* ============================================================
   CASH OUT — early exit before settlement
   ------------------------------------------------------------
   Simulated cashout value based on random "current likelihood".
   In production this would come from a live odds feed.
   ============================================================ */
async function cashOut(userId, reference) {
  const bet = await prisma.bet.findUnique({
    where: { reference },
    include: { selections: true },
  });
  if (!bet) throw new AppError('Bet not found', 404, 'BET_NOT_FOUND');
  if (bet.userId !== userId) throw new AppError('Not your bet', 403, 'FORBIDDEN');
  if (bet.status !== 'PENDING') {
    throw new AppError(`Cannot cash out — bet status is ${bet.status}`, 400, 'INVALID_STATE');
  }

  const stake = new Decimal(bet.stake);
  const potential = new Decimal(bet.potentialWin);

  // Simulated: 60% chance the bet is currently ahead
  const isAhead = Math.random() < 0.6;

  let cashoutAmount;
  if (isAhead) {
    // 80% of potential win (early exit for profit)
    cashoutAmount = potential.mul(0.80).toDecimalPlaces(2);
  } else {
    // 40% of stake back (cut losses)
    cashoutAmount = stake.mul(0.40).toDecimalPlaces(2);
  }

  // Consume the locked stake, then credit the cashout
  await walletService.consumeLocked(userId, stake.toString(), {
    betId: bet.id,
    reference: generateRef('TXN'),
    description: `Cash out: ${bet.reference}`,
    currency: bet.currency,
  });

  await walletService.credit(userId, cashoutAmount.toString(), {
    type: 'BET_WON',
    description: `Cash out payout: ${bet.reference}`,
    betId: bet.id,
    currency: bet.currency,
  });

  const updated = await prisma.bet.update({
    where: { id: bet.id },
    data: {
      status: 'CASHED_OUT',
      cashoutAmount: cashoutAmount.toString(),
      actualWin: cashoutAmount.toString(),
      settledAt: new Date(),
      settledBy: 'user-cashout',
    },
    include: { selections: true },
  });

  logger.info(
    { userId, reference, cashout: cashoutAmount.toString() },
    '💰 Bet cashed out'
  );

  return publicBet(updated);
}

/* ============================================================
   GET QUOTE — preview what a cashout would be worth
   ============================================================ */
async function getCashoutQuote(userId, reference) {
  const bet = await prisma.bet.findUnique({ where: { reference } });
  if (!bet) throw new AppError('Bet not found', 404, 'BET_NOT_FOUND');
  if (bet.userId !== userId) throw new AppError('Not your bet', 403, 'FORBIDDEN');
  if (bet.status !== 'PENDING') {
    throw new AppError('Cannot cash out — bet is already settled', 400, 'INVALID_STATE');
  }

  const stake = new Decimal(bet.stake);
  const potential = new Decimal(bet.potentialWin);

  // Deterministic preview: midpoint between stake and potential
  const minQuote = stake.mul(0.4);
  const maxQuote = potential.mul(0.85);
  const quote = minQuote.plus(maxQuote).div(2).toDecimalPlaces(2);

  return {
    reference: bet.reference,
    stake: stake.toString(),
    potentialWin: potential.toString(),
    minQuote: minQuote.toString(),
    maxQuote: maxQuote.toString(),
    currentQuote: quote.toString(),
    currency: bet.currency,
    note: 'Quote fluctuates with live odds. Final value locked at execution.',
  };
}

/* ============================================================
   READ
   ============================================================ */
async function list(userId, { page = 1, limit = 20, status, type } = {}) {
  const skip = (page - 1) * limit;
  const where = { userId };
  if (status) where.status = status;
  if (type) where.type = type;

  const [items, total] = await Promise.all([
    prisma.bet.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: { selections: true },
    }),
    prisma.bet.count({ where }),
  ]);

  return {
    items: items.map(publicBet),
    pagination: { page, limit, total },
  };
}

async function getOne(userId, reference) {
  const bet = await prisma.bet.findUnique({
    where: { reference },
    include: { selections: true },
  });
  if (!bet || bet.userId !== userId) {
    throw new AppError('Bet not found', 404, 'BET_NOT_FOUND');
  }
  return publicBet(bet);
}

/* ============================================================
   PUBLIC SHAPE
   ============================================================ */
function publicBet(bet) {
  return {
    id: bet.id,
    reference: bet.reference,
    type: bet.type,
    status: bet.status,
    stake: bet.stake.toString(),
    totalOdds: bet.totalOdds.toString(),
    potentialWin: bet.potentialWin.toString(),
    actualWin: bet.actualWin ? bet.actualWin.toString() : null,
    cashoutAmount: bet.cashoutAmount ? bet.cashoutAmount.toString() : null,
    currency: bet.currency,
    gameType: bet.gameType,
    roundId: bet.roundId,
    settledAt: bet.settledAt,
    settledBy: bet.settledBy,
    selections: (bet.selections || []).map((s) => ({
      id: s.id,
      eventId: s.eventId,
      eventName: s.eventName,
      market: s.market,
      selection: s.selection,
      odds: s.odds.toString(),
      status: s.status,
      eventStartAt: s.eventStartAt,
      result: s.result,
    })),
    createdAt: bet.createdAt,
    updatedAt: bet.updatedAt,
  };
}

module.exports = {
  place,
  settle,
  cashOut,
  getCashoutQuote,
  list,
  getOne,
};