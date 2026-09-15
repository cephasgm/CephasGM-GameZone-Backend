/**
 * ============================================================
 * CephasGM GameZone — Game Controller
 * ============================================================
 */

'use strict';

const gameManager = require('../services/games/roundManager');
const games = require('../services/games');
const prisma = require('../config/database');
const apiResponse = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');
const { AppError } = require('../utils/AppError');

/* GET /games — summary of all currently running rounds */
const getAllRounds = asyncHandler(async (req, res) => {
  return apiResponse.ok(res, gameManager.getAllRoundsSummary());
});

/* GET /games/:gameType/current — current round for one game */
const getCurrentRound = asyncHandler(async (req, res) => {
  const gameType = String(req.params.gameType).toUpperCase();

  if (!games.ENGINES[gameType]) {
    throw new AppError(`Unknown game type: ${gameType}`, 404, 'UNKNOWN_GAME');
  }

  const round = gameManager.getCurrentRound(gameType);

  if (!round) {
    return apiResponse.ok(res, { gameType, message: 'No active round — waiting for next' });
  }

  return apiResponse.ok(res, round);
});

/* GET /games/:gameType/history — last N completed rounds */
const getHistory = asyncHandler(async (req, res) => {
  const gameType = String(req.params.gameType).toUpperCase();
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));

  if (!games.ENGINES[gameType]) {
    throw new AppError(`Unknown game type: ${gameType}`, 404, 'UNKNOWN_GAME');
  }

  const rounds = await prisma.gameRound.findMany({
    where: { gameType, status: 'COMPLETED' },
    orderBy: { roundNumber: 'desc' },
    take: limit,
    select: {
      id: true,
      roundNumber: true,
      status: true,
      result: true,
      serverSeed: true,
      serverSeedHash: true,
      publicSeed: true,
      startedAt: true,
      settledAt: true,
      totalBets: true,
      totalStaked: true,
      totalPaidOut: true,
    },
  });

  return apiResponse.ok(res, rounds);
});

/* GET /games/rounds/:roundId — single round detail (with fairness proof) */
const getRoundDetail = asyncHandler(async (req, res) => {
  const round = await prisma.gameRound.findUnique({
    where: { id: req.params.roundId },
  });

  if (!round) {
    throw new AppError('Round not found', 404, 'ROUND_NOT_FOUND');
  }

  return apiResponse.ok(res, {
    id: round.id,
    gameType: round.gameType,
    roundNumber: round.roundNumber,
    status: round.status,
    serverSeed: round.serverSeed,
    serverSeedHash: round.serverSeedHash,
    publicSeed: round.publicSeed,
    result: round.result,
    startedAt: round.startedAt,
    settledAt: round.settledAt,
    fairnessProof: {
      commitment: round.serverSeedHash,
      revealed: round.serverSeed,
      verified:
        require('crypto')
          .createHash('sha256')
          .update(round.serverSeed)
          .digest('hex') === round.serverSeedHash,
    },
  });
});

module.exports = {
  getAllRounds,
  getCurrentRound,
  getHistory,
  getRoundDetail,
};