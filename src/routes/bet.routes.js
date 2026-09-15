/**
 * ============================================================
 * CephasGM GameZone — Bet Routes
 * ============================================================
 * Mounted at /api/v1/bets
 * ============================================================
 */

'use strict';

const express = require('express');
const router = express.Router();

const betController = require('../controllers/bet.controller');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { betLimiter } = require('../middleware/rateLimiter');
const {
  placeBetSchema,
  listBetsSchema,
  referenceParamSchema,
} = require('../validators/bet.validator');

router.use(requireAuth);

router.post(
  '/',
  betLimiter,
  validate(placeBetSchema),
  betController.place
);

router.get(
  '/',
  validate({ query: listBetsSchema }),
  betController.list
);

router.get(
  '/:reference',
  validate({ params: referenceParamSchema }),
  betController.getOne
);

router.get(
  '/:reference/cashout-quote',
  validate({ params: referenceParamSchema }),
  betController.cashoutQuote
);

router.post(
  '/:reference/cashout',
  betLimiter,
  validate({ params: referenceParamSchema }),
  betController.cashOut
);

module.exports = router;