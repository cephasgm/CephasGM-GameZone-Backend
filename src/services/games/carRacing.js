/**
 * ============================================================
 * CephasGM GameZone — Virtual Car Racing Engine
 * ============================================================
 * Same model as horse racing: 8 racers, hidden strength,
 * jitter to make any racer a possible winner.
 *
 * Result shape:
 *   {
 *     racers: [
 *       { number, driver, team, position },
 *       ...
 *     ],
 *     winner: { number, driver, team }
 *   }
 * ============================================================
 */

'use strict';

const prisma = require('../../config/database');
const logger = require('../../config/logger');
const rng = require('./rng');
const football = require('./football');

const DRIVERS = [
  'M. Verstappen', 'L. Hamilton', 'C. Leclerc', 'L. Norris',
  'C. Sainz', 'G. Russell', 'S. Perez', 'F. Alonso',
  'E. Ocon', 'P. Gasly', 'V. Bottas', 'Y. Tsunoda',
];

const TEAMS = [
  'Red Bull', 'Ferrari', 'Mercedes', 'McLaren',
  'Aston Martin', 'Alpine', 'Williams', 'Haas',
];

const NUM_RACERS = 8;

/* ============================================================
   RESULT ENGINE
   ============================================================ */
function computeResult({ serverSeed, publicSeed, roundId }) {
  const message = `cars:${roundId}:${publicSeed}`;

  const drivers = rng.deriveShuffle(serverSeed, `${message}:drivers`, DRIVERS).slice(0, NUM_RACERS);
  const teams   = rng.deriveShuffle(serverSeed, `${message}:teams`, TEAMS).slice(0, NUM_RACERS);

  const racers = drivers.map((driver, i) => {
    const strength = rng.deriveFloat(serverSeed, `${message}:strength:${i}`);
    const jitter   = rng.deriveFloat(serverSeed, `${message}:jitter:${i}`);

    /* Racing has more jitter than horse racing — upsets are more common */
    const score = strength * 0.6 + jitter * 0.4;

    return { number: i + 1, driver, team: teams[i], score };
  });

  racers.sort((a, b) => b.score - a.score);
  racers.forEach((r, idx) => { r.position = idx + 1; });

  const winner = racers[0];

  return {
    racers: racers.map((r) => ({
      number: r.number,
      driver: r.driver,
      team: r.team,
      position: r.position,
    })),
    winner: { number: winner.number, driver: winner.driver, team: winner.team },
  };
}

/* ============================================================
   SETTLE
   ============================================================ */
async function settleRound(gameType, roundState) {
  if (gameType !== 'VIRTUAL_CAR_RACING') return;

  const winner = roundState.result?.winner;
  if (!winner) return;

  const pendingBets = await prisma.bet.findMany({
    where: {
      gameType: 'VIRTUAL_CAR_RACING',
      roundId: roundState.id,
      status: 'PENDING',
    },
    include: { selections: true },
  });

  if (pendingBets.length === 0) {
    logger.info({ roundNumber: roundState.roundNumber }, '🏎️  Car race settled — no active bets');
    return;
  }

  for (const bet of pendingBets) {
    const won = bet.selections.some((sel) => {
      const matchByNumber = String(sel.eventId) === String(winner.number);
      const matchByName = String(sel.selection).toLowerCase() === winner.driver.toLowerCase();
      return matchByNumber || matchByName;
    });

    await football.settleBet(bet, won, roundState.roundNumber);
  }

  logger.info(
    { roundNumber: roundState.roundNumber, winner: winner.driver, betsSettled: pendingBets.length },
    '🏎️  Car race settled'
  );
}

module.exports = { computeResult, settleRound, NUM_RACERS };