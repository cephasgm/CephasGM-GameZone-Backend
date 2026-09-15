/**
 * ============================================================
 * CephasGM GameZone — Withdraw Routes
 * ============================================================
 * Mounted at /api/v1/withdrawals
 * ============================================================
 */

'use strict';

const express = require('express');
const router = express.Router();

const withdrawController = require('../controllers/withdraw.controller');
const { requireAuth, requireKYC } = require('../middleware/auth');
const { adminOnly } = require('../middleware/adminOnly');
const { validate } = require('../middleware/validate');
const { paymentLimiter } = require('../middleware/rateLimiter');
const {
  requestWithdrawalSchema,
  listPaymentsSchema,
  referenceParamSchema,
  approveWithdrawalSchema,
  rejectWithdrawalSchema,
} = require('../validators/payment.validator');

/* ---------- WEBHOOK (public) ---------- */
router.post('/webhook/:provider', withdrawController.webhook);

/* ---------- USER ---------- */

router.post(
  '/',
  requireAuth,
  requireKYC,             // KYC must be approved before requesting withdrawals
  paymentLimiter,
  validate(requestWithdrawalSchema),
  withdrawController.request
);

router.get(
  '/',
  requireAuth,
  validate({ query: listPaymentsSchema }),
  withdrawController.list
);

router.get(
  '/:reference',
  requireAuth,
  validate({ params: referenceParamSchema }),
  withdrawController.getOne
);

/* ---------- ADMIN ---------- */

router.post(
  '/:reference/approve',
  requireAuth,
  adminOnly,
  validate({ params: referenceParamSchema, body: approveWithdrawalSchema }),
  withdrawController.approve
);

router.post(
  '/:reference/reject',
  requireAuth,
  adminOnly,
  validate({ params: referenceParamSchema, body: rejectWithdrawalSchema }),
  withdrawController.reject
);

module.exports = router;