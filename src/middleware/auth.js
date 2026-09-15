/**
 * ============================================================
 * CephasGM GameZone — Authentication Middleware
 * ============================================================
 * Exports:
 *   • requireAuth      — 401 if no valid access token
 *   • optionalAuth     — attaches req.user if token present, else passes through
 *   • requireVerified  — 403 if user hasn't verified email
 *   • requireKYC       — 403 if KYC not approved
 *
 * Attaches: req.user = { id, email, phone, role, status, ... }
 * ============================================================
 */

'use strict';

const jwt = require('jsonwebtoken');

const config = require('../config');
const logger = require('../config/logger');
const prisma = require('../config/database');
const { AppError } = require('../utils/AppError');

/* ------------------------------------------------------------
   Extract "Bearer <token>" from the Authorization header
   ------------------------------------------------------------ */
function extractToken(req) {
  const header = req.headers.authorization || req.headers.Authorization;
  if (!header) return null;

  const parts = header.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return null;
  }
  return parts[1];
}

/* ------------------------------------------------------------
   Verify the JWT and load the user from DB
   ------------------------------------------------------------ */
async function verifyAndLoadUser(token) {
  let payload;
  try {
    payload = jwt.verify(token, config.jwt.accessSecret);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw new AppError('Access token expired', 401, 'TOKEN_EXPIRED');
    }
    if (err.name === 'JsonWebTokenError') {
      throw new AppError('Invalid access token', 401, 'TOKEN_INVALID');
    }
    throw new AppError('Authentication failed', 401, 'AUTH_FAILED');
  }

  // Payload must have the sub claim (user id)
  if (!payload || !payload.sub) {
    throw new AppError('Malformed token payload', 401, 'TOKEN_INVALID');
  }

  // Load fresh user from DB — so role / status changes take effect immediately
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: {
      id: true,
      email: true,
      phone: true,
      fullName: true,
      username: true,
      role: true,
      status: true,
      emailVerified: true,
      phoneVerified: true,
      kycStatus: true,
      currency: true,
      createdAt: true,
    },
  });

  if (!user) {
    throw new AppError('Account no longer exists', 401, 'USER_NOT_FOUND');
  }

  if (user.status === 'SUSPENDED') {
    throw new AppError('Account is suspended', 403, 'ACCOUNT_SUSPENDED');
  }

  if (user.status === 'BANNED') {
    throw new AppError('Account is banned', 403, 'ACCOUNT_BANNED');
  }

  if (user.status === 'CLOSED') {
    throw new AppError('Account is closed', 403, 'ACCOUNT_CLOSED');
  }

  return user;
}

/* ------------------------------------------------------------
   requireAuth — 401 if not authenticated
   ------------------------------------------------------------ */
async function requireAuth(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) {
      throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');
    }

    const user = await verifyAndLoadUser(token);

    // Attach to request for downstream handlers
    req.user = user;
    req.token = token;

    next();
  } catch (err) {
    next(err);
  }
}

/* ------------------------------------------------------------
   optionalAuth — attach req.user if a valid token is present,
   otherwise continue as an anonymous request
   ------------------------------------------------------------ */
async function optionalAuth(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) {
      return next();
    }

    try {
      const user = await verifyAndLoadUser(token);
      req.user = user;
      req.token = token;
    } catch (err) {
      // Silently ignore auth failures on optional routes
      logger.debug({ err: err.message }, 'optionalAuth ignored invalid token');
    }

    next();
  } catch (err) {
    next(err);
  }
}

/* ------------------------------------------------------------
   requireVerified — user must have verified email
   ------------------------------------------------------------ */
function requireVerified(req, res, next) {
  if (!req.user) {
    return next(new AppError('Authentication required', 401, 'AUTH_REQUIRED'));
  }

  if (!req.user.emailVerified) {
    return next(
      new AppError(
        'Please verify your email first',
        403,
        'EMAIL_NOT_VERIFIED'
      )
    );
  }

  next();
}

/* ------------------------------------------------------------
   requireKYC — user must have approved KYC (for withdrawals etc.)
   ------------------------------------------------------------ */
function requireKYC(req, res, next) {
  if (!req.user) {
    return next(new AppError('Authentication required', 401, 'AUTH_REQUIRED'));
  }

  if (req.user.kycStatus !== 'APPROVED') {
    return next(
      new AppError(
        'KYC verification required to perform this action',
        403,
        'KYC_REQUIRED'
      )
    );
  }

  next();
}

/* ------------------------------------------------------------
   requireRole — role-based gate (used by admin routes)
   Usage: requireRole('ADMIN', 'SUPERADMIN')
   ------------------------------------------------------------ */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return next(new AppError('Authentication required', 401, 'AUTH_REQUIRED'));
    }

    if (!allowedRoles.includes(req.user.role)) {
      logger.warn(
        { userId: req.user.id, role: req.user.role, path: req.path },
        'Role-gated route access denied'
      );
      return next(
        new AppError(
          'You do not have permission to access this resource',
          403,
          'FORBIDDEN'
        )
      );
    }

    next();
  };
}

/* ------------------------------------------------------------
   signAccessToken — helper to create an access token
   ------------------------------------------------------------ */
function signAccessToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      role: user.role,
      email: user.email,
      type: 'access',
    },
    config.jwt.accessSecret,
    {
      expiresIn: config.jwt.accessExpiresIn,
      issuer: config.appName,
      audience: 'cephasgm-api',
    }
  );
}

/* ------------------------------------------------------------
   Exports
   ------------------------------------------------------------ */
module.exports = {
  requireAuth,
  optionalAuth,
  requireVerified,
  requireKYC,
  requireRole,
  signAccessToken,
  extractToken, // exported for refresh-token flow
};