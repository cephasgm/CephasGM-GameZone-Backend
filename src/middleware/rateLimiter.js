/**
 * ============================================================
 * CephasGM GameZone — Rate Limiters
 * ============================================================
 * Four tiers of protection:
 *   • apiLimiter       — global, applied to all /api/v1 routes
 *   • authLimiter      — tight, for login / register / OTP
 *   • betLimiter       — one per few seconds, for placing bets
 *   • paymentLimiter   — for deposit / withdraw endpoints
 *
 * Uses in-memory store by default. Swap to Redis by setting
 * REDIS_ENABLED=true in .env (config.redis.enabled).
 * ============================================================
 */

'use strict';

const rateLimit = require('express-rate-limit');

const config = require('../config');
const logger = require('../config/logger');

/* ------------------------------------------------------------
   Shared response shape when a limit is hit
   ------------------------------------------------------------ */
function limitHandler(req, res, next, options) {
  logger.warn(
    { ip: req.ip, path: req.path, userId: req.user?.id },
    '🚫 Rate limit exceeded'
  );

  res.status(options.statusCode).json({
    success: false,
    message: options.message,
    code: 'RATE_LIMITED',
    retryAfter: Math.ceil(options.windowMs / 1000),
  });
}

/* ------------------------------------------------------------
   Key generator — use user id if authenticated, else IP
   ------------------------------------------------------------ */
const keyGenerator = (req) => {
  if (req.user && req.user.id) return `user:${req.user.id}`;
  return `ip:${req.ip}`;
};

/* ------------------------------------------------------------
   1. Global API limiter
   ------------------------------------------------------------ */
const apiLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs, // default 15 min
  max: config.rateLimit.max,           // default 100 requests
  standardHeaders: 'draft-7',          // RateLimit-* headers
  legacyHeaders: false,
  keyGenerator,
  handler: limitHandler,
  message: 'Too many requests from this account — please slow down.',
  skip: (req) => {
    // Never rate-limit health checks
    return req.path === '/health';
  },
});

/* ------------------------------------------------------------
   2. Auth limiter — login, register, OTP, password reset
   ------------------------------------------------------------ */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min window
  max: config.rateLimit.authMax, // default 10 attempts
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Key by email + IP so distributed attackers on the same IP
    // can still be blocked on a per-account basis, but we don't
    // lock out a whole IP for one user's typos.
    const email = req.body?.email?.toLowerCase?.() || '';
    return `auth:${req.ip}:${email}`;
  },
  handler: limitHandler,
  message: 'Too many attempts — please wait 15 minutes before trying again.',
  skipSuccessfulRequests: true, // successful logins don't count toward the limit
});

/* ------------------------------------------------------------
   3. Bet limiter — placing bets and cashouts
   ------------------------------------------------------------ */
const betLimiter = rateLimit({
  windowMs: 10 * 1000, // 10 seconds
  max: config.rateLimit.betMax, // default 30 → ~3/sec, plenty for real users
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator,
  handler: limitHandler,
  message: 'Slow down — you are placing bets too quickly.',
});

/* ------------------------------------------------------------
   4. Payment limiter — deposit and withdraw requests
   ------------------------------------------------------------ */
const paymentLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5,              // 5 payment attempts per minute
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator,
  handler: limitHandler,
  message: 'Too many payment requests — please wait a moment.',
});

/* ------------------------------------------------------------
   5. OTP limiter — very strict, for sending OTPs
   ------------------------------------------------------------ */
const otpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,                   // 5 OTP sends per hour per IP+phone
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => {
    const phone = req.body?.phone || req.body?.mobile || '';
    return `otp:${req.ip}:${phone}`;
  },
  handler: limitHandler,
  message: 'Too many OTP requests — try again in an hour.',
});

module.exports = {
  apiLimiter,
  authLimiter,
  betLimiter,
  paymentLimiter,
  otpLimiter,
};