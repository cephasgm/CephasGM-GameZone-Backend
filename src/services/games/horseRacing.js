/**
 * ============================================================
 * CephasGM GameZone — Virtual Horse Racing Engine
 * ============================================================
 * 8 runners per race. Each horse has a hidden "strength" that
 * determines finishing position.
 *
 * Result shape:
 *   {
 *     runners: [
 *       { number, name, position },   // position 1..8
 *       ...
 *     ],
 *     winner: { number, name }
 *   }
 * ============================================================
 */

'use strict';

const prisma = require('../../config/database');
const logger = require('../../config/logger');
const rng = require('./rng');
const football = require('./football'); // reuse settleBet

const HORSE_NAMES = [
  'Thunder Bolt', 'Silver Arrow', 'Midnight Star', 'Golden Hoof',
  'Desert Wind', 'Royal Flush', 'Lucky Streak', 'Iron Duke',
  'Wild Fire', 'Storm Chaser', 'Blue Diamond', 'Crimson Flash',
  'Shadow Dancer', 'Northern Light', 'Rapid Fire', 'Emerald King',
];

const NUM_RUNNERS = 8;

/* ============================================================
   RESULT ENGINE
   ============================================================ */
function computeResult({ serverSeed, publicSeed, roundId }) {
  const message = `horses:${roundId}:${publicSeed}`;

  const names = rng.deriveShuffle(serverSeed, `${message}:names`, HORSE_NAMES).slice(0, NUM_RUNNERS);

  const runners = names.map((name, i) => {
    /* Hidden "strength" 0..1 for each horse */
    const strength = rng.deriveFloat(serverSeed, `${message}:strength:${i}`);

    /* Randomness — races aren't fully deterministic from strength alone */
    const jitter = rng.deriveFloat(serverSeed, `${message}:jitter:${i}`);

    /* Final score: mostly strength, some jitter */
    const score = strength * 0.7 + jitter * 0.3;

    return { number: i + 1, name, score };
  });

  /* Sort by score descending — highest wins */
  runners.sort((a, b) => b.score - a.score);
  runners.forEach((r, idx) => { r.position = idx + 1; });

  const winner = runners[0];

  return {
    runners: runners.map((r) => ({ number: r.number, name: r.name, position: r.position })),
    winner: { number: winner.number, name: winner.name },
  };
}

/* ============================================================
   SETTLE
   ============================================================ */
async function settleRound(gameType, roundState) {
  if (gameType !== 'VIRTUAL_HORSE_RACING') return;

  const winner = roundState.result?.winner;
  if (!winner) return;

  const pendingBets = await prisma.bet.findMany({
    where: {
      gameType: 'VIRTUAL_HORSE_RACING',
      roundId: roundState.id,
      status: 'PENDING',
    },
    include: { selections: true },
  });

  if (pendingBets.length === 0) {
    logger.info({ roundNumber: roundState.roundNumber }, '🐎 Horse race settled — no active bets');
    return;
  }

  for (const bet of pendingBets) {
    /* A horse-racing bet wins if the picked runner is the winner */
    const won = bet.selections.some((sel) => {
      /* Match by runner number stored in `eventId` or name in `selection` */
      const matchByNumber = String(sel.eventId) === String(winner.number);
      const matchByName = String(sel.selection).toLowerCase() === winner.name.toLowerCase();
      return matchByNumber || matchByName;
    });

    await football.settleBet(bet, won, roundState.roundNumber);
  }

  logger.info(
    { roundNumber: roundState.roundNumber, winner: winner.name, betsSettled: pendingBets.length },
    '🐎 Horse race settled'
  );
}

module.exports = { computeResult, settleRound, NUM_RUNNERS };