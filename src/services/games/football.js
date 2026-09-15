/**
 * ============================================================
 * CephasGM GameZone — Virtual Football Engine
 * ============================================================
 * Simulates 8 matches per round. Each match has a hidden
 * probability profile (home/draw/away) that drives a full
 * 90-minute score simulation.
 *
 * Result shape:
 *   {
 *     matches: [
 *       { id, home, away, scoreHome, scoreAway, result: '1'|'X'|'2' },
 *       ...
 *     ]
 *   }
 * ============================================================
 */

'use strict';

const prisma = require('../../config/database');
const logger = require('../../config/logger');
const rng = require('./rng');
const walletService = require('../wallet.service');
const { generateRef } = require('../../utils/generateRef');

/* ------------------------------------------------------------
   Team pool — same as the frontend
   ------------------------------------------------------------ */
const TEAMS = [
  { name: 'Arsenal',     short: 'ARS' },
  { name: 'Chelsea',     short: 'CHE' },
  { name: 'Man City',    short: 'MCI' },
  { name: 'Liverpool',   short: 'LIV' },
  { name: 'Man United',  short: 'MUN' },
  { name: 'Tottenham',   short: 'TOT' },
  { name: 'Real Madrid', short: 'RMA' },
  { name: 'Barcelona',   short: 'BAR' },
  { name: 'Atletico',    short: 'ATM' },
  { name: 'Sevilla',     short: 'SEV' },
  { name: 'Juventus',    short: 'JUV' },
  { name: 'Inter',       short: 'INT' },
  { name: 'AC Milan',    short: 'MIL' },
  { name: 'Napoli',      short: 'NAP' },
  { name: 'Bayern',      short: 'BAY' },
  { name: 'Dortmund',    short: 'BVB' },
];

const NUM_MATCHES = 8;

/* ============================================================
   RESULT ENGINE
   ============================================================ */
function computeResult({ serverSeed, publicSeed, roundId }) {
  const message = `football:${roundId}:${publicSeed}`;

  /* Shuffle teams deterministically */
  const shuffled = rng.deriveShuffle(serverSeed, message, TEAMS);

  const matches = [];

  for (let i = 0; i < NUM_MATCHES; i++) {
    const home = shuffled[i * 2];
    const away = shuffled[i * 2 + 1];

    const matchId = `m${i}-${roundId}`;

    /* Hidden bias — home advantage */
    const bias = rng.deriveFloat(serverSeed, `${message}:bias:${i}`);

    /* Base probabilities */
    let pHome = 0.30 + bias * 0.40;
    let pDraw = 0.22 + (1 - Math.abs(bias - 0.5) * 2) * 0.10;
    let pAway = 1 - pHome - pDraw;
    if (pAway < 0.10) { pAway = 0.10; pHome -= 0.05; }
    if (pHome < 0.10) { pHome = 0.10; pAway -= 0.05; }

    /* Simulate score — Poisson-ish approximation */
    const scoreHome = simulateGoals(serverSeed, `${message}:sh:${i}`, pHome);
    const scoreAway = simulateGoals(serverSeed, `${message}:sa:${i}`, pAway);

    const result =
      scoreHome > scoreAway ? '1' :
      scoreHome < scoreAway ? '2' :
      'X';

    matches.push({
      id: matchId,
      home: home.short,
      homeName: home.name,
      away: away.short,
      awayName: away.name,
      scoreHome,
      scoreAway,
      result,
    });
  }

  return { matches };
}

/* ------------------------------------------------------------
   Simple goal count — weighted random
   ------------------------------------------------------------ */
function simulateGoals(serverSeed, message, probability) {
  /* Expected goals per team = probability * 5 (roughly 0-4 goals) */
  const expected = probability * 5;
  const u = rng.deriveFloat(serverSeed, message);

  /* Poisson-like: sum of many Bernoullis */
  let goals = 0;
  for (let i = 0; i < 8; i++) {
    const roll = rng.deriveFloat(serverSeed, `${message}:${i}`);
    if (roll < expected / 8) goals++;
  }
  return goals;
}

/* ============================================================
   SETTLE — resolve all pending football bets for this round
   ============================================================ */
async function settleRound(gameType, roundState) {
  if (gameType !== 'VIRTUAL_FOOTBALL') return;

  const matches = roundState.result?.matches || [];
  const matchMap = new Map(matches.map((m) => [m.id, m]));

  const pendingBets = await prisma.bet.findMany({
    where: {
      gameType: 'VIRTUAL_FOOTBALL',
      roundId: roundState.id,
      status: 'PENDING',
    },
    include: { selections: true },
  });

  if (pendingBets.length === 0) {
    logger.info(
      { roundNumber: roundState.roundNumber },
      '⚽ Football round settled — no active bets'
    );
    return;
  }

  for (const bet of pendingBets) {
    /* A bet wins only if ALL selections are correct */
    let allWon = true;

    for (const sel of bet.selections) {
      const match = matchMap.get(sel.eventId);
      if (!match) { allWon = false; break; }

      /* sel.selection holds the pick: '1', 'X', '2' */
      if (match.result !== sel.selection) {
        allWon = false;
        break;
      }
    }

    await settleBet(bet, allWon, roundState.roundNumber);
  }

  logger.info(
    { roundNumber: roundState.roundNumber, betsSettled: pendingBets.length },
    '⚽ Football round settled'
  );
}

/* ------------------------------------------------------------
   Shared settlement helper for all virtual games
   ------------------------------------------------------------ */
async function settleBet(bet, won, roundNumber) {
  const stake = bet.stake.toString();

  try {
    if (won) {
      await walletService.creditWinnings(bet.userId, stake, bet.potentialWin.toString(), {
        betId: bet.id,
        reference: generateRef('TXN'),
        description: `${bet.gameType} won (round ${roundNumber})`,
        currency: bet.currency,
      });

      await prisma.bet.update({
        where: { id: bet.id },
        data: {
          status: 'WON',
          actualWin: bet.potentialWin.toString(),
          settledAt: new Date(),
          settledBy: 'virtual-round',
        },
      });
    } else {
      await walletService.consumeLocked(bet.userId, stake, {
        betId: bet.id,
        reference: generateRef('TXN'),
        description: `${bet.gameType} lost (round ${roundNumber})`,
        currency: bet.currency,
      });

      await prisma.bet.update({
        where: { id: bet.id },
        data: {
          status: 'LOST',
          actualWin: '0',
          settledAt: new Date(),
          settledBy: 'virtual-round',
        },
      });
    }
  } catch (err) {
    logger.error(
      { reference: bet.reference, err: err.message },
      '❌ Bet settlement failed'
    );
  }
}

module.exports = {
  computeResult,
  settleRound,
  settleBet,   // exported so other engines reuse it
  NUM_MATCHES,
  TEAMS,
};