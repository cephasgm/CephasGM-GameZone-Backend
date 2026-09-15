/**
 * ============================================================
 * CephasGM GameZone — Session Cleanup Job
 * ============================================================
 * Runs every 6 hours.
 *
 * Deletes sessions that are:
 *   • Revoked, OR
 *   • Expired (expiresAt in the past)
 *
 * Keeps the sessions table lean so lookups stay fast.
 * ============================================================
 */

'use strict';

const prisma = require('../config/database');
const logger = require('../config/logger');

async function run() {
  const result = await prisma.session.deleteMany({
    where: {
      OR: [
        { revokedAt: { not: null } },
        { expiresAt: { lt: new Date() } },
      ],
    },
  });

  if (result.count > 0) {
    logger.info({ deleted: result.count }, `🧹 Cleaned up ${result.count} sessions`);
  }

  return { deleted: result.count };
}

module.exports = { run };