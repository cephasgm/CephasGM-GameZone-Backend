/**
 * ============================================================
 * CephasGM GameZone — Round Manager
 * ============================================================
 * Manages the full lifecycle of virtual game rounds across all
 * game types. Each game has its own timing config and result
 * engine, but they all share this common orchestration:
 *
 *   SCHEDULED → BETTING_OPEN → IN_PROGRESS → COMPLETED
 *
 * The round manager is the only place that writes GameRound rows.
 * Game-specific engines only compute results.
 * ============================================================
 */

'use strict';

const config = require('../../config');
const logger = require('../../config/logger');
const prisma = require('../../config/database');
const { AppError } = require('../../utils/AppError');
const rng = require('./rng');

/* ============================================================
   GAME CONFIG — timing per game type (milliseconds)
   ============================================================ */
const GAME_TIMINGS = {
  VIRTUAL_FOOTBALL:     { bettingMs: 20000, activeMs: 35000, cooldownMs: 5000 },
  VIRTUAL_HORSE_RACING: { bettingMs: 20000, activeMs: 25000, cooldownMs: 5000 },
  VIRTUAL_CAR_RACING:   { bettingMs: 20000, activeMs: 25000, cooldownMs: 5000 },
  VIRTUAL_NETBALL:      { bettingMs: 20000, activeMs: 30000, cooldownMs: 5000 },
  AVIATOR:              { bettingMs: 15000, activeMs: 30000, cooldownMs: 5000 },
};

/* ============================================================
   IN-MEMORY STATE
   ------------------------------------------------------------
   Holds the currently active round for each game type so we
   don't hit the DB on every tick. Rebuilt on server restart.
   ============================================================ */
const activeRounds = new Map();
const roundTimers = new Map();

/* ============================================================
   START A ROUND
   ============================================================ */
async function startRound(gameType, engineFn) {
  const timings = GAME_TIMINGS[gameType];
  if (!timings) throw new AppError(`Unknown game type: ${gameType}`, 400, 'UNKNOWN_GAME');

  /* Get the next round number (atomic) */
  const last = await prisma.gameRound.findFirst({
    where: { gameType },
    orderBy: { roundNumber: 'desc' },
    select: { roundNumber: true },
  });
  const roundNumber = (last?.roundNumber || 0) + 1;

  /* Generate provably-fair seeds */
  const serverSeed = rng.generateServerSeed();
  const serverSeedHash = rng.hashServerSeed(serverSeed);
  const publicSeed = rng.generatePublicSeed();

  /* Compute result now — kept secret until round ends */
  const result = engineFn({ serverSeed, publicSeed, roundId: roundNumber });

  /* Create the round row */
  const round = await prisma.gameRound.create({
    data: {
      gameType,
      roundNumber,
      status: 'BETTING_OPEN',
      serverSeed,
      serverSeedHash,
      publicSeed,
      result,
      startedAt: new Date(),
    },
  });

  /* Track in-memory for fast lookups */
  activeRounds.set(gameType, {
    id: round.id,
    roundNumber: round.roundNumber,
    serverSeed,
    serverSeedHash,
    publicSeed,
    result,
    startedAt: Date.now(),
    bettingMs: timings.bettingMs,
    activeMs: timings.activeMs,
    cooldownMs: timings.cooldownMs,
    phase: 'betting',
  });

  logger.info(
    { gameType, roundNumber, hash: serverSeedHash.slice(0, 16) },
    `🎲 [${gameType}] Round #${roundNumber} starting (betting open)`
  );

  return round;
}

/* ============================================================
   PHASE TRANSITIONS
   ------------------------------------------------------------
   Called by setInterval every second. Moves each active round
   through its phases based on elapsed time.
   ============================================================ */
async function tick(engineFunctions, settleFn) {
  const now = Date.now();

  for (const [gameType, round] of activeRounds.entries()) {
    const elapsed = now - round.startedAt;

    /* -------------------- BETTING → ACTIVE -------------------- */
    if (round.phase === 'betting' && elapsed >= round.bettingMs) {
      await prisma.gameRound.update({
        where: { id: round.id },
        data: { status: 'IN_PROGRESS' },
      });
      round.phase = 'active';
      round.phaseStartedAt = now;

      logger.info(
        { gameType, roundNumber: round.roundNumber },
        `▶️  [${gameType}] Round #${round.roundNumber} in progress`
      );
    }

    /* -------------------- ACTIVE → SETTLEMENT ----------------- */
    else if (round.phase === 'active' && elapsed >= round.bettingMs + round.activeMs) {
      round.phase = 'settling';

      /* Settle all bets via the settlement service */
      try {
        await settleFn(gameType, round);
      } catch (err) {
        logger.error(
          { gameType, roundNumber: round.roundNumber, err: err.message },
          '❌ Settlement failed'
        );
      }

      /* Mark round complete + reveal server seed */
      await prisma.gameRound.update({
        where: { id: round.id },
        data: {
          status: 'COMPLETED',
          settledAt: new Date(),
        },
      });

      round.phase = 'cooldown';
      round.phaseStartedAt = now;

      logger.info(
        {
          gameType,
          roundNumber: round.roundNumber,
          serverSeed: round.serverSeed.slice(0, 16) + '...',
        },
        `✅ [${gameType}] Round #${round.roundNumber} settled — seed revealed`
      );
    }

    /* -------------------- COOLDOWN → NEXT ROUND -------------- */
    else if (round.phase === 'cooldown' && elapsed >= round.bettingMs + round.activeMs + round.cooldownMs) {
      activeRounds.delete(gameType);
      const engineFn = engineFunctions[gameType];
      if (engineFn) {
        await startRound(gameType, engineFn).catch((err) =>
          logger.error({ gameType, err: err.message }, '❌ Failed to start next round')
        );
      }
    }
  }
}

/* ============================================================
   GETTERS
   ============================================================ */
function getCurrentRound(gameType) {
  const round = activeRounds.get(gameType);
  if (!round) return null;

  const now = Date.now();
  const elapsed = now - round.startedAt;

  /* Compute time remaining in current phase */
  let phaseEndsAt;
  let phase;
  if (round.phase === 'betting') {
    phase = 'BETTING_OPEN';
    phaseEndsAt = round.startedAt + round.bettingMs;
  } else if (round.phase === 'active') {
    phase = 'IN_PROGRESS';
    phaseEndsAt = round.startedAt + round.bettingMs + round.activeMs;
  } else if (round.phase === 'cooldown') {
    phase = 'COMPLETED';
    phaseEndsAt = null;
  } else {
    phase = round.phase.toUpperCase();
    phaseEndsAt = null;
  }

  /* Result is hidden while betting/active */
  const showResult = round.phase === 'cooldown' || round.phase === 'settling';

  return {
    id: round.id,
    roundNumber: round.roundNumber,
    gameType,
    status: phase,
    serverSeedHash: round.serverSeedHash,
    publicSeed: round.publicSeed,
    startedAt: new Date(round.startedAt).toISOString(),
    phaseEndsAt: phaseEndsAt ? new Date(phaseEndsAt).toISOString() : null,
    msRemaining: phaseEndsAt ? Math.max(0, phaseEndsAt - now) : 0,
    result: showResult ? round.result : null,
    /* Reveal seed only after round completes */
    serverSeed: showResult ? round.serverSeed : null,
  };
}

function getActiveGameTypes() {
  return Array.from(activeRounds.keys());
}

function getAllRoundsSummary() {
  const out = {};
  for (const gameType of Object.keys(GAME_TIMINGS)) {
    out[gameType] = getCurrentRound(gameType);
  }
  return out;
}

/* ============================================================
   AUTOSTART — begins the tick loop
   ============================================================ */
let tickTimer = null;

function startAuto(engineFunctions, settleFn, intervalMs = 1000) {
  if (tickTimer) return;

  tickTimer = setInterval(() => {
    tick(engineFunctions, settleFn).catch((err) =>
      logger.error({ err: err.message }, '❌ Round manager tick error')
    );
  }, intervalMs);

  logger.info(
    { games: Object.keys(engineFunctions) },
    '🔄 Round manager autostart enabled'
  );
}

function stopAuto() {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
    logger.info('Round manager autostart stopped');
  }
}

/* ============================================================
   RECOVER — rebuild in-memory state after a restart
   ============================================================ */
async function recoverActiveRounds() {
  const inProgress = await prisma.gameRound.findMany({
    where: { status: { in: ['BETTING_OPEN', 'IN_PROGRESS'] } },
  });

  for (const row of inProgress) {
    /* Any round from a previous process is stale — mark as cancelled */
    await prisma.gameRound.update({
      where: { id: row.id },
      data: { status: 'CANCELLED', settledAt: new Date() },
    });
  }

  if (inProgress.length) {
    logger.info(
      { count: inProgress.length },
      '🧹 Cleaned up stale rounds from previous process'
    );
  }
}

module.exports = {
  GAME_TIMINGS,
  startRound,
  tick,
  getCurrentRound,
  getActiveGameTypes,
  getAllRoundsSummary,
  startAuto,
  stopAuto,
  recoverActiveRounds,
};