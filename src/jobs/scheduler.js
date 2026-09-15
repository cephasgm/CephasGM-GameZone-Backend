/**
 * ============================================================
 * CephasGM GameZone — Background Jobs Scheduler
 * ============================================================
 * Runs:
 *   • Virtual game round manager (autostart, 1s tick)
 *   • Bet settlement sweep (every 30s)
 *   • Bonus expiry (hourly)
 *   • Session cleanup (every 6h)
 * ============================================================
 */

'use strict';

const config = require('../config');
const logger = require('../config/logger');
const roundManager = require('../services/games/roundManager');
const games = require('../services/games');

const settleBetsJob = require('./settleBets.job');
const bonusExpiryJob = require('./bonusExpiry.job');
const sessionCleanupJob = require('./sessionCleanup.job');

let started = false;
const intervals = [];

async function startJobs() {
  if (started) return;
  started = true;

  logger.info('🚀 Starting background jobs');

  /* 1. Recover stale virtual game rounds from previous process */
  try {
    await roundManager.recoverActiveRounds();
  } catch (err) {
    logger.error({ err: err.message }, '❌ Failed to recover stale rounds');
  }

  /* 2. Autostart virtual games */
  try {
    const engineFunctions = games.RESULT_ENGINES;
    const settleFn = games.settleRound;

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

    roundManager.startAuto(engineFunctions, settleFn, 1000);
  } catch (err) {
    logger.error({ err: err.message }, '❌ Failed to start virtual games');
  }

  /* 3. Schedule recurring jobs */
  const scheduleJob = (name, fn, intervalMs) => {
    const handle = setInterval(() => {
      fn().catch((err) =>
        logger.error({ job: name, err: err.message }, `❌ Job "${name}" failed`)
      );
    }, intervalMs);
    handle.unref();
    intervals.push(handle);
    logger.info({ job: name, intervalMs }, `📅 Job scheduled: ${name}`);
  };

  /* Bet settlement sweep — every 30 seconds */
  scheduleJob('settleBets', settleBetsJob.run, 30 * 1000);

  /* Bonus expiry — hourly */
  scheduleJob('bonusExpiry', bonusExpiryJob.run, 60 * 60 * 1000);

  /* Session cleanup — every 6 hours */
  scheduleJob('sessionCleanup', sessionCleanupJob.run, 6 * 60 * 60 * 1000);

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

  for (const handle of intervals) {
    clearInterval(handle);
  }
  intervals.length = 0;

  logger.info('Background jobs stopped');
}

module.exports = { startJobs, stopJobs };