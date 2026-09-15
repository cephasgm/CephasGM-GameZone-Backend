/**
 * ============================================================
 * CephasGM GameZone — Game Engine Registry
 * ============================================================
 */

'use strict';

const aviator      = require('./aviator');
const football     = require('./football');
const horseRacing  = require('./horseRacing');
const carRacing    = require('./carRacing');
const netball      = require('./netball');

/* Map GameType → engine */
const ENGINES = {
  AVIATOR:              aviator,
  VIRTUAL_FOOTBALL:     football,
  VIRTUAL_HORSE_RACING: horseRacing,
  VIRTUAL_CAR_RACING:   carRacing,
  VIRTUAL_NETBALL:      netball,
};

/* Map GameType → computeResult function (used by round manager) */
const RESULT_ENGINES = Object.fromEntries(
  Object.entries(ENGINES).map(([type, engine]) => [type, engine.computeResult])
);

/* Dispatch table for settlement */
async function settleRound(gameType, roundState) {
  const engine = ENGINES[gameType];
  if (!engine || typeof engine.settleRound !== 'function') return;
  return engine.settleRound(gameType, roundState);
}

module.exports = {
  ENGINES,
  RESULT_ENGINES,
  settleRound,
};