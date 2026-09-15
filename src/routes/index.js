/**
 * ============================================================
 * CephasGM GameZone — Master Router
 * ============================================================
 */

'use strict';

const express = require('express');
const router = express.Router();

/* Health probe */
router.get('/health', (req, res) => {
  res.json({ success: true, message: 'API is healthy', api: '/api/v1' });
});

/* Domain routers */
router.use('/auth', require('./auth.routes'));
router.use('/wallet', require('./wallet.routes'));
router.use('/transactions', require('./transaction.routes'));
router.use('/deposits', require('./deposit.routes'));
router.use('/withdrawals', require('./withdraw.routes'));
router.use('/bets', require('./bet.routes'));

/* Fallback */
router.use((req, res, next) => {
  const { AppError } = require('../utils/AppError');
  next(AppError.notFound(`API route ${req.method} ${req.originalUrl}`));
});

module.exports = router;