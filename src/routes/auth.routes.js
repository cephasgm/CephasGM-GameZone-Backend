/**
 * ============================================================
 * CephasGM GameZone — Auth Routes
 * ============================================================
 * All routes are mounted under /api/v1/auth
 * ============================================================
 */

'use strict';

const express = require('express');
const router = express.Router();

const authController = require('../controllers/auth.controller');
const { validate } = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { authLimiter, otpLimiter } = require('../middleware/rateLimiter');
const {
  registerSchema,
  loginSchema,
  verifyEmailSchema,
  resendVerificationSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  refreshSchema,
  changePasswordSchema,
} = require('../validators/auth.validator');

/* ------------------------------------------------------------
   Public routes
   ------------------------------------------------------------ */

// Register
router.post(
  '/register',
  authLimiter,
  validate(registerSchema),
  authController.register
);

// Login
router.post(
  '/login',
  authLimiter,
  validate(loginSchema),
  authController.login
);

// Refresh access token
router.post(
  '/refresh',
  validate(refreshSchema),
  authController.refresh
);

// Logout
router.post(
  '/logout',
  validate(refreshSchema),
  authController.logout
);

// Verify email with OTP
router.post(
  '/verify-email',
  otpLimiter,
  validate(verifyEmailSchema),
  authController.verifyEmail
);

// Resend verification code
router.post(
  '/resend-verification',
  otpLimiter,
  validate(resendVerificationSchema),
  authController.resendVerification
);

// Request password reset
router.post(
  '/forgot-password',
  otpLimiter,
  validate(forgotPasswordSchema),
  authController.forgotPassword
);

// Complete password reset
router.post(
  '/reset-password',
  authLimiter,
  validate(resetPasswordSchema),
  authController.resetPassword
);

/* ------------------------------------------------------------
   Authenticated routes
   ------------------------------------------------------------ */

// Change password (logged in)
router.post(
  '/change-password',
  requireAuth,
  validate(changePasswordSchema),
  authController.changePassword
);

// Get current user profile
router.get(
  '/me',
  requireAuth,
  authController.getMe
);

module.exports = router;