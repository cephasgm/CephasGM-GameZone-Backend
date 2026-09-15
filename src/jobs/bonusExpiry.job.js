/**
 * ============================================================
 * CephasGM GameZone — Bonus Expiry Job
 * ============================================================
 * Runs hourly.
 *
 * Marks any ACTIVE bonus whose expiresAt has passed as EXPIRED.
 * Also removes the corresponding bonusBalance from the wallet
 * (they never wagered it in time — the money disappears).
 * ============================================================
 */

'use strict';

const prisma = require('../config/database');
const logger = require('../config/logger');

async function run() {
  const expired = await prisma.userBonus.findMany({
    where: {
      status: 'ACTIVE',
      expiresAt: { lt: new Date() },
    },
    take: 200,
  });

  if (expired.length === 0) return { expired: 0 };

  let count = 0;

  for (const ub of expired) {
    try {
      /* Mark expired + remove remaining bonusBalance */
      await prisma.$transaction(async (tx) => {
        await tx.userBonus.update({
          where: { id: ub.id },
          data: { status: 'EXPIRED' },
        });

        /* Remove the remaining bonus amount from the wallet */
        await tx.wallet.updateMany({
          where: { userId: ub.userId, currency: 'TZS' },
          data: { bonusBalance: { decrement: ub.amount.toString() } },
        });
      });

      count++;
    } catch (err) {
      logger.error(
        { userBonusId: ub.id, err: err.message },
        '❌ Bonus expiry failed'
      );
    }
  }

  if (count > 0) {
    logger.info({ count }, `⏰ ${count} bonuses expired`);
  }

  return { expired: count };
}

module.exports = { run };