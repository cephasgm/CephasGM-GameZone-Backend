/**
 * ============================================================
 * CephasGM GameZone — Master Router
 * ============================================================
 * Mounts every sub-router under /api/v1.
 * Additional routers (wallet, bets, games, kyc, etc.) get added
 * here as we build them in later waves.
 * ============================================================
 */

'use strict';

const express = require('express');
const router = express.Router();

const authRoutes = require('./auth.routes');

/* ------------------------------------------------------------
   Health probe (in case someone hits /api/v1/health)
   ------------------------------------------------------------ */
router.get('/health', (req, res) => {
  res.json({ success: true, message: 'API is healthy', api: '/api/v1' });
});

/* ------------------------------------------------------------
   Domain routers
   ------------------------------------------------------------ */
router.use('/auth', authRoutes);

/* Placeholders — populated in later waves */
// router.use('/users',        require('./user.routes'));
// router.use('/wallet',       require('./wallet.routes'));
// router.use('/transactions', require('./transaction.routes'));
// router.use('/deposits',     require('./deposit.routes'));
// router.use('/withdrawals',  require('./withdraw.routes'));
// router.use('/bets',         require('./bet.routes'));
// router.use('/games',        require('./game.routes'));
// router.use('/kyc',          require('./kyc.routes'));
// router.use('/bonuses',      require('./bonus.routes'));
// router.use('/referrals',    require('./referral.routes'));
// router.use('/notifications',require('./notification.routes'));
// router.use('/support',      require('./support.routes'));
// router.use('/leaderboard',  require('./leaderboard.routes'));
// router.use('/admin',        require('./admin.routes'));

/* ------------------------------------------------------------
   Fallback — anything under /api/v1 not matched above
   ------------------------------------------------------------ */
router.use((req, res, next) => {
  next(
    require('../utils/AppError').AppError.notFound(
      `API route ${req.method} ${req.originalUrl}`
    )
  );
});

module.exports = router;