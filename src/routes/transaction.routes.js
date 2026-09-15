/**
 * ============================================================
 * CephasGM GameZone — Transaction Routes (top-level alias)
 * ============================================================
 * Mounted at /api/v1/transactions
 * Same handlers as /wallet/transactions — just exposed at the
 * domain root for cleaner URL structure on the frontend.
 * ============================================================
 */

'use strict';

const express = require('express');
const router = express.Router();

const transactionController = require('../controllers/transaction.controller');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const {
  listTransactionsSchema,
  summarySchema,
  referenceParamSchema,
} = require('../validators/wallet.validator');

router.use(requireAuth);

router.get('/', validate({ query: listTransactionsSchema }), transactionController.list);
router.get('/summary', validate({ query: summarySchema }), transactionController.summary);
router.get('/:reference', validate({ params: referenceParamSchema }), transactionController.getOne);

module.exports = router;