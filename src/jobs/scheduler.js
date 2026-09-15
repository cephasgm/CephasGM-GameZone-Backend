/**
 * ============================================================
 * CephasGM GameZone — Background Jobs Scheduler (stub)
 * ============================================================
 * Boots all cron jobs. Full implementation
 * (bet settlement, virtual rounds, bonus expiry) comes in Wave 9.
 * ============================================================
 */

'use strict';

const logger = require('../config/logger');

let started = false;

function startJobs() {
  if (started) return;
  started = true;
  logger.info('✅ Background jobs scheduler initialised (no jobs yet)');
}

function stopJobs() {
  if (!started) return;
  started = false;
  logger.info('Background jobs scheduler stopped');
}

module.exports = { startJobs, stopJobs };