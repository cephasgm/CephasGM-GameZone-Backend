/**
 * ============================================================
 * CephasGM GameZone — Wallet Routes
 * ============================================================
 * Mounted at /api/v1/wallet
 * ============================================================
 */

'use strict';

const express = require('express');
const router = express.Router();

const walletController = require('../controllers/wallet.controller');
const transactionController = require('../controllers/transaction.controller');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const {
  listTransactionsSchema,
  summarySchema,
  referenceParamSchema,
} = require('../validators/wallet.validator');

/* Every route here requires authentication */
router.use(requireAuth);

/* Wallet summary */
router.get('/', walletController.getWallet);
router.get('/balance', walletController.getBalance);
router.get('/wallets', walletController.listWallets);

/* Transactions (nested for convenience) */
router.get(
  '/transactions',
  validate({ query: listTransactionsSchema }),
  transactionController.list
);

router.get(
  '/transactions/summary',
  validate({ query: summarySchema }),
  transactionController.summary
);

router.get(
  '/transactions/:reference',
  validate({ params: referenceParamSchema }),
  transactionController.getOne
);

module.exports = router;