/**
 * ============================================================
 * CephasGM GameZone — Deposit Routes
 * ============================================================
 * Mounted at /api/v1/deposits
 * ============================================================
 */

'use strict';

const express = require('express');
const router = express.Router();

const depositController = require('../controllers/deposit.controller');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { paymentLimiter } = require('../middleware/rateLimiter');
const {
  initiateDepositSchema,
  listPaymentsSchema,
  referenceParamSchema,
} = require('../validators/payment.validator');

/* ---------- PUBLIC ---------- */

// Webhook endpoints — no auth, no body JSON parsing issues
router.post('/webhook/:provider', depositController.webhook);

/* ---------- AUTHENTICATED ---------- */

// List available methods (works without auth too, but keeping consistent)
router.get('/methods', depositController.methods);

router.post(
  '/',
  requireAuth,
  paymentLimiter,
  validate(initiateDepositSchema),
  depositController.initiate
);

router.get(
  '/',
  requireAuth,
  validate({ query: listPaymentsSchema }),
  depositController.list
);

router.get(
  '/:reference',
  requireAuth,
  validate({ params: referenceParamSchema }),
  depositController.getOne
);

router.get(
  '/:reference/status',
  requireAuth,
  validate({ params: referenceParamSchema }),
  depositController.checkStatus
);

// Dev-only simulator — the service itself rejects if NODE_ENV != development
router.post(
  '/:reference/simulate',
  requireAuth,
  validate({ params: referenceParamSchema }),
  depositController.simulate
);

module.exports = router;