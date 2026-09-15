/**
 * ============================================================
 * CephasGM GameZone — Virtual Netball Engine
 * ============================================================
 * 8 matches per round. Each match simulates 4 quarters of
 * netball, producing a final score (typically 40–70 goals).
 *
 * Result shape:
 *   {
 *     matches: [
 *       { id, home, away, scoreHome, scoreAway, quarterScores: [...], result: '1'|'X'|'2' },
 *       ...
 *     ]
 *   }
 * ============================================================
 */

'use strict';

const prisma = require('../../config/database');
const logger = require('../../config/logger');
const rng = require('./rng');
const football = require('./football');

const TEAMS = [
  { name: 'Australia',    short: 'AUS' },
  { name: 'New Zealand',  short: 'NZL' },
  { name: 'England',      short: 'ENG' },
  { name: 'Jamaica',      short: 'JAM' },
  { name: 'South Africa', short: 'RSA' },
  { name: 'Uganda',       short: 'UGA' },
  { name: 'Malawi',       short: 'MWI' },
  { name: 'Wales',        short: 'WAL' },
  { name: 'Scotland',     short: 'SCO' },
  { name: 'N. Ireland',   short: 'NIR' },
  { name: 'Trinidad',     short: 'TTO' },
  { name: 'Fiji',         short: 'FIJ' },
  { name: 'Barbados',     short: 'BAR' },
  { name: 'Sri Lanka',    short: 'SRI' },
  { name: 'Singapore',    short: 'SGP' },
  { name: 'Zimbabwe',     short: 'ZIM' },
];

const NUM_MATCHES = 8;
const NUM_QUARTERS = 4;

/* ============================================================
   RESULT ENGINE
   ============================================================ */
function computeResult({ serverSeed, publicSeed, roundId }) {
  const message = `netball:${roundId}:${publicSeed}`;

  const shuffled = rng.deriveShuffle(serverSeed, `${message}:teams`, TEAMS);

  const matches = [];

  for (let i = 0; i < NUM_MATCHES; i++) {
    const home = shuffled[i * 2];
    const away = shuffled[i * 2 + 1];
    const matchId = `n${i}-${roundId}`;

    /* Home advantage */
    const bias = rng.deriveFloat(serverSeed, `${message}:bias:${i}`);

    /* Netball scoring rates per quarter (per team) */
    const homeRate = 12 + bias * 8;   // 12–20 goals/quarter
    const awayRate = 12 + (1 - bias) * 8;

    let totalHome = 0;
    let totalAway = 0;
    const quarterScores = [];

    for (let q = 0; q < NUM_QUARTERS; q++) {
      const qHome = scoreQuarter(serverSeed, `${message}:h:${i}:${q}`, homeRate);
      const qAway = scoreQuarter(serverSeed, `${message}:a:${i}:${q}`, awayRate);

      totalHome += qHome;
      totalAway += qAway;
      quarterScores.push({ quarter: q + 1, home: qHome, away: qAway });
    }

    /* Netball rarely draws, but we allow it for the market */
    const result =
      totalHome > totalAway ? '1' :
      totalHome < totalAway ? '2' :
      'X';

    matches.push({
      id: matchId,
      home: home.short,
      homeName: home.name,
      away: away.short,
      awayName: away.name,
      scoreHome: totalHome,
      scoreAway: totalAway,
      quarterScores,
      result,
    });
  }

  return { matches };
}

/* ------------------------------------------------------------
   Score one quarter for a team at given rate
   ------------------------------------------------------------ */
function scoreQuarter(serverSeed, message, rate) {
  /* rate is expected goals per quarter (~12-20).
     We sum up 20 independent Bernoulli trials to get a
     Poisson-like distribution. */
  let goals = 0;
  for (let i = 0; i < 25; i++) {
    const roll = rng.deriveFloat(serverSeed, `${message}:${i}`);
    if (roll < rate / 25) goals++;
  }
  return goals;
}

/* ============================================================
   SETTLE
   ============================================================ */
async function settleRound(gameType, roundState) {
  if (gameType !== 'VIRTUAL_NETBALL') return;

  const matches = roundState.result?.matches || [];
  const matchMap = new Map(matches.map((m) => [m.id, m]));

  const pendingBets = await prisma.bet.findMany({
    where: {
      gameType: 'VIRTUAL_NETBALL',
      roundId: roundState.id,
      status: 'PENDING',
    },
    include: { selections: true },
  });

  if (pendingBets.length === 0) {
    logger.info({ roundNumber: roundState.roundNumber }, '🏐 Netball settled — no active bets');
    return;
  }

  for (const bet of pendingBets) {
    let allWon = true;

    for (const sel of bet.selections) {
      const match = matchMap.get(sel.eventId);
      if (!match) { allWon = false; break; }
      if (match.result !== sel.selection) { allWon = false; break; }
    }

    await football.settleBet(bet, allWon, roundState.roundNumber);
  }

  logger.info(
    { roundNumber: roundState.roundNumber, betsSettled: pendingBets.length },
    '🏐 Netball settled'
  );
}

module.exports = { computeResult, settleRound, NUM_MATCHES, NUM_QUARTERS };