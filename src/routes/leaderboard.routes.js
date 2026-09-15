/**
 * ============================================================
 * CephasGM GameZone — Leaderboard Routes
 * ============================================================
 * Mounted at /api/v1/leaderboard
 * ============================================================
 */

'use strict';

const express = require('express');
const router = express.Router();

const leaderboardController = require('../controllers/leaderboard.controller');
const { optionalAuth, requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { leaderboardQuerySchema } = require('../validators/leaderboard.validator');

/* Public — anyone can see the leaderboard */
router.get('/', optionalAuth, validate({ query: leaderboardQuerySchema }), leaderboardController.getTop);

/* Auth — see your own rank */
router.get('/me', requireAuth, validate({ query: leaderboardQuerySchema }), leaderboardController.getMine);

module.exports = router;