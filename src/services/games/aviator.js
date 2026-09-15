/**
 * ============================================================
 * CephasGM GameZone — Aviator Engine
 * ============================================================
 * A crash game. Multiplier starts at 1.00x and grows
 * exponentially. Players must cash out before the crash.
 *
 * The crash point is computed BEFORE the round starts (using
 * provably-fair RNG) but kept secret until the crash.
 *
 * Multiplier formula (matches frontend):
 *   m(t) = e^(0.18 * t)      where t = seconds since flight began
 *
 * Cash-out at any moment:
 *   payout = stake * currentMultiplier
 * ============================================================
 */

'use strict';

const Decimal = require('decimal.js');
const config = require('../../config');
const logger = require('../../config/logger');
const prisma = require('../../config/database');
const { AppError } = require('../../utils/AppError');
const rng = require('./rng');

const GROWTH_RATE = 0.18;

/* ============================================================
   RESULT ENGINE — compute crash point for the round
   ============================================================ */
function computeResult({ serverSeed, publicSeed, roundId }) {
  const crash = rng.deriveCrashPoint(
    serverSeed,
    `${roundId}:${publicSeed}`,
    config.games.aviator.houseEdge,
    config.games.aviator.minCrash,
    config.games.aviator.maxCrash
  );
  return { crashPoint: crash };
}

/* ============================================================
   CURRENT MULTIPLIER — time-based
   ============================================================ */
function currentMultiplier(roundStartedAtMs, nowMs = Date.now()) {
  const elapsed = Math.max(0, (nowMs - roundStartedAtMs) / 1000);
  const m = Math.exp(GROWTH_RATE * elapsed);
  return Math.floor(m * 100) / 100;
}

/* ============================================================
   PLACE BET
   ------------------------------------------------------------
   Placing a bet on Aviator is done through the standard bet
   service with gameType='AVIATOR' and the current roundId.
   This file only exposes cashout + settlement.
   ============================================================ */

/* ============================================================
   CASH OUT — user exits at current multiplier
   ============================================================ */
async function cashOut(userId, reference, roundStartedAtMs) {
  const bet = await prisma.bet.findUnique({ where: { reference } });
  if (!bet) throw new AppError('Bet not found', 404, 'BET_NOT_FOUND');
  if (bet.userId !== userId) throw new AppError('Not your bet', 403, 'FORBIDDEN');
  if (bet.gameType !== 'AVIATOR') throw new AppError('Not an Aviator bet', 400, 'WRONG_GAME');
  if (bet.status !== 'PENDING') {
    throw new AppError('Bet already settled', 400, 'INVALID_STATE');
  }

  const now = Date.now();
  const multiplier = currentMultiplier(roundStartedAtMs, now);

  const stake = new Decimal(bet.stake);
  const payout = stake.mul(multiplier).toDecimalPlaces(2);

  // Consume the locked stake, credit the payout
  const walletService = require('../wallet.service');

  await walletService.consumeLocked(userId, stake.toString(), {
    betId: bet.id,
    reference: require('../../utils/generateRef').generateRef('TXN'),
    description: `Aviator cashout at ${multiplier}x`,
    currency: bet.currency,
  });

  await walletService.credit(userId, payout.toString(), {
    type: 'BET_WON',
    description: `Aviator won at ${multiplier}x`,
    betId: bet.id,
    currency: bet.currency,
  });

  const updated = await prisma.bet.update({
    where: { id: bet.id },
    data: {
      status: 'CASHED_OUT',
      cashoutAmount: payout.toString(),
      actualWin: payout.toString(),
      settledAt: new Date(),
      settledBy: 'aviator-user-cashout',
    },
  });

  logger.info(
    { userId, reference, multiplier, payout: payout.toString() },
    '💰 Aviator cashout'
  );

  return {
    betReference: reference,
    multiplier,
    stake: stake.toString(),
    payout: payout.toString(),
    currency: bet.currency,
  };
}

/* ============================================================
   SETTLE — called when the round crashes
   ------------------------------------------------------------
   Any bet still PENDING loses its stake.
   ============================================================ */
async function settleRound(gameType, roundState) {
  if (gameType !== 'AVIATOR') return;

  const crash = roundState.result?.crashPoint ?? 1.0;

  const pendingBets = await prisma.bet.findMany({
    where: {
      gameType: 'AVIATOR',
      roundId: roundState.id,
      status: 'PENDING',
    },
  });

  if (pendingBets.length === 0) {
    logger.info({ roundId: roundState.roundNumber, crash }, '💥 Aviator crashed — no active bets');
    return;
  }

  const walletService = require('../wallet.service');
  const generateRef = require('../../utils/generateRef').generateRef;

  for (const bet of pendingBets) {
    try {
      await walletService.consumeLocked(bet.userId, bet.stake.toString(), {
        betId: bet.id,
        reference: generateRef('TXN'),
        description: `Aviator crashed at ${crash}x`,
        currency: bet.currency,
      });

      await prisma.bet.update({
        where: { id: bet.id },
        data: {
          status: 'LOST',
          actualWin: '0',
          settledAt: new Date(),
          settledBy: 'aviator-crash',
        },
      });
    } catch (err) {
      logger.error({ reference: bet.reference, err: err.message }, '❌ Aviator settle failed');
    }
  }

  logger.info(
    { roundId: roundState.roundNumber, crash, settled: pendingBets.length },
    `💥 Aviator crashed at ${crash}x — ${pendingBets.length} bets lost`
  );
}

module.exports = {
  computeResult,
  currentMultiplier,
  cashOut,
  settleRound,
  GROWTH_RATE,
};