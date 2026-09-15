/**
 * ============================================================
 * CephasGM GameZone — Background Jobs Scheduler
 * ============================================================
 * Boots and manages:
 *   • Virtual game round manager (autostart loop)
 *   • (Future) Bet settlement sweep, bonus expiry, etc.
 * ============================================================
 */

'use strict';

const config = require('../config');
const logger = require('../config/logger');
const roundManager = require('../services/games/roundManager');
const games = require('../services/games');

let started = false;

async function startJobs() {
  if (started) return;
  started = true;

  logger.info('🚀 Starting background jobs');

  /* Clean up any stale rounds from a previous process */
  try {
    await roundManager.recoverActiveRounds();
  } catch (err) {
    logger.error({ err: err.message }, '❌ Failed to recover stale rounds');
  }

  /* Autostart the virtual games round manager */
  try {
    const engineFunctions = games.RESULT_ENGINES;
    const settleFn = games.settleRound;

    /* Kick off one round per game type immediately */
    for (const gameType of Object.keys(engineFunctions)) {
      roundManager
        .startRound(gameType, engineFunctions[gameType])
        .catch((err) =>
          logger.error(
            { gameType, err: err.message },
            `❌ Failed to start initial ${gameType} round`
          )
        );
    }

    /* Then start the tick loop that advances all rounds */
    roundManager.startAuto(engineFunctions, settleFn, 1000);

    logger.info(
      { games: Object.keys(engineFunctions) },
      '✅ Virtual games running'
    );
  } catch (err) {
    logger.error({ err: err.message }, '❌ Failed to start virtual games');
  }

  logger.info('✅ Background jobs started');
}

function stopJobs() {
  if (!started) return;
  started = false;

  try {
    roundManager.stopAuto();
  } catch (err) {
    logger.error({ err: err.message }, '⚠️  Failed to stop round manager');
  }

  logger.info('Background jobs stopped');
}

module.exports = { startJobs, stopJobs };