/**
 * ============================================================
 * CephasGM GameZone — Game Routes
 * ============================================================
 * Mounted at /api/v1/games
 * ============================================================
 */

'use strict';

const express = require('express');
const router = express.Router();

const gameController = require('../controllers/game.controller');
const { optionalAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const {
  gameTypeParamSchema,
  roundIdParamSchema,
  historyQuerySchema,
} = require('../validators/game.validator');

/* All game routes are public (optional auth attaches user if present) */
router.use(optionalAuth);

/* Summary of all games — what's running right now */
router.get('/', gameController.getAllRounds);

/* Current round for one game */
router.get(
  '/:gameType/current',
  validate({ params: gameTypeParamSchema }),
  gameController.getCurrentRound
);

/* Recent completed rounds */
router.get(
  '/:gameType/history',
  validate({ params: gameTypeParamSchema, query: historyQuerySchema }),
  gameController.getHistory
);

/* Single round detail with fairness proof */
router.get(
  '/rounds/:roundId',
  validate({ params: roundIdParamSchema }),
  gameController.getRoundDetail
);

module.exports = router;