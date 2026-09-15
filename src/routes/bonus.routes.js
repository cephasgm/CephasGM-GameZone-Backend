/**
 * ============================================================
 * CephasGM GameZone — Bonus Routes
 * ============================================================
 * Mounted at /api/v1/bonuses
 * ============================================================
 */

'use strict';

const express = require('express');
const router = express.Router();

const bonusController = require('../controllers/bonus.controller');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const {
  claimBonusSchema,
  listBonusesQuerySchema,
} = require('../validators/bonus.validator');

router.use(requireAuth);

router.get('/', bonusController.listAvailable);
router.post('/claim', validate(claimBonusSchema), bonusController.claim);
router.get('/mine', validate({ query: listBonusesQuerySchema }), bonusController.listMine);

module.exports = router;