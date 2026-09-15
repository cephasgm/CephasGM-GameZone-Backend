/**
 * ============================================================
 * CephasGM GameZone — KYC Routes
 * ============================================================
 * Mounted at /api/v1/kyc
 * ============================================================
 */

'use strict';

const express = require('express');
const router = express.Router();

const kycController = require('../controllers/kyc.controller');
const { requireAuth } = require('../middleware/auth');
const { adminOnly } = require('../middleware/adminOnly');
const { validate } = require('../middleware/validate');
const { submitKYCSchema, reviewKYCSchema } = require('../validators/kyc.validator');

router.use(requireAuth);

/* USER */
router.post('/', validate(submitKYCSchema), kycController.submit);
router.get('/me', kycController.getMyStatus);

/* ADMIN */
router.post(
  '/:userId/review',
  adminOnly,
  validate(reviewKYCSchema),
  kycController.review
);

module.exports = router;