/**
 * ============================================================
 * CephasGM GameZone — Referral Routes
 * ============================================================
 * Mounted at /api/v1/referrals
 * ============================================================
 */

'use strict';

const express = require('express');
const router = express.Router();

const referralController = require('../controllers/referral.controller');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { listReferralsQuerySchema } = require('../validators/referral.validator');

router.use(requireAuth);

router.get('/me', referralController.getMyCode);
router.get('/', validate({ query: listReferralsQuerySchema }), referralController.listMine);

module.exports = router;