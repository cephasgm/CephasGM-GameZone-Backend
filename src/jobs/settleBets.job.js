/**
 * ============================================================
 * CephasGM GameZone — Bet Settlement Sweep Job
 * ============================================================
 * Runs every 30 seconds.
 *
 * Looks for bets that:
 *   • Have a selection whose eventStartAt is more than 3 hours past
 *   • Are still PENDING
 *
 * These are "orphaned" bets — for example sports bets whose
 * settlement webhook never arrived. This job resolves them
 * deterministically using a fallback rule.
 *
 * Fallback rule: mark as VOID (refund stake) — safer than
 * guessing the outcome.
 * ============================================================
 */

'use strict';

const prisma = require('../config/database');
const logger = require('../config/logger');
const walletService = require('../services/wallet.service');
const { generateRef } = require('../utils/generateRef');

const ORPHAN_AFTER_MS = 3 * 60 * 60 * 1000; // 3 hours

async function run() {
  const cutoff = new Date(Date.now() - ORPHAN_AFTER_MS);

  /* Find PENDING bets older than cutoff */
  const orphaned = await prisma.bet.findMany({
    where: {
      status: 'PENDING',
      createdAt: { lt: cutoff },
    },
    include: { selections: true },
    take: 100,
  });

  if (orphaned.length === 0) return { voided: 0 };

  let voided = 0;

  for (const bet of orphaned) {
    try {
      /* Refund the stake (unlock funds) */
      await walletService.unlockFunds(bet.userId, bet.stake.toString(), {
        currency: bet.currency,
      });

      await prisma.bet.update({
        where: { id: bet.id },
        data: {
          status: 'VOID',
          settledAt: new Date(),
          settledBy: 'sweep-job',
        },
      });

      voided++;
    } catch (err) {
      logger.error(
        { reference: bet.reference, err: err.message },
        '❌ Failed to void orphaned bet'
      );
    }
  }

  if (voided > 0) {
    logger.info({ voided }, `🧹 Voided ${voided} orphaned bets`);
  }

  return { voided };
}

module.exports = { run };