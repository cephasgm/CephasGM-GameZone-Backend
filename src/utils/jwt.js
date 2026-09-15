/**
 * ============================================================
 * CephasGM GameZone — JWT Utilities
 * ============================================================
 * Access tokens:   15m lifetime, used on every authenticated request
 * Refresh tokens:  30d lifetime, used only to mint new access tokens
 *
 * Both tokens carry a `type` claim so a refresh token can never be
 * used as an access token and vice versa.
 * ============================================================
 */

'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');
const { AppError } = require('./AppError');

/* ------------------------------------------------------------
   Issuer / audience — embedded in every token
   ------------------------------------------------------------ */
const ISSUER = config.appName;
const AUDIENCE = 'cephasgm-api';

/* ------------------------------------------------------------
   Sign an access token (15m)
   ------------------------------------------------------------ */
function signAccessToken(user) {
  const payload = {
    sub: user.id,
    role: user.role,
    email: user.email || null,
    type: 'access',
  };

  return jwt.sign(payload, config.jwt.accessSecret, {
    expiresIn: config.jwt.accessExpiresIn,
    issuer: ISSUER,
    audience: AUDIENCE,
  });
}

/* ------------------------------------------------------------
   Sign a refresh token (30d)
   ------------------------------------------------------------ */
function signRefreshToken(user, sessionId) {
  const payload = {
    sub: user.id,
    sid: sessionId,      // session id — for revocation
    type: 'refresh',
  };

  return jwt.sign(payload, config.jwt.refreshSecret, {
    expiresIn: config.jwt.refreshExpiresIn,
    issuer: ISSUER,
    audience: AUDIENCE,
  });
}

/* ------------------------------------------------------------
   Verify an access token — returns payload or throws AppError
   ------------------------------------------------------------ */
function verifyAccessToken(token) {
  try {
    const payload = jwt.verify(token, config.jwt.accessSecret, {
      issuer: ISSUER,
      audience: AUDIENCE,
    });

    if (payload.type !== 'access') {
      throw new AppError('Invalid token type', 401, 'TOKEN_INVALID');
    }

    return payload;
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err.name === 'TokenExpiredError') {
      throw new AppError('Access token expired', 401, 'TOKEN_EXPIRED');
    }
    throw new AppError('Invalid access token', 401, 'TOKEN_INVALID');
  }
}

/* ------------------------------------------------------------
   Verify a refresh token — returns payload or throws AppError
   ------------------------------------------------------------ */
function verifyRefreshToken(token) {
  try {
    const payload = jwt.verify(token, config.jwt.refreshSecret, {
      issuer: ISSUER,
      audience: AUDIENCE,
    });

    if (payload.type !== 'refresh') {
      throw new AppError('Invalid token type', 401, 'TOKEN_INVALID');
    }

    return payload;
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err.name === 'TokenExpiredError') {
      throw new AppError('Refresh token expired', 401, 'REFRESH_EXPIRED');
    }
    throw new AppError('Invalid refresh token', 401, 'REFRESH_INVALID');
  }
}

/* ------------------------------------------------------------
   Decode without verifying — for debugging only, NEVER trust
   ------------------------------------------------------------ */
function decodeUnsafe(token) {
  try {
    return jwt.decode(token);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------
   Calculate the expiry date of a refresh token
   Used when creating the Session row.
   ------------------------------------------------------------ */
function getRefreshExpiryDate() {
  const expiresIn = config.jwt.refreshExpiresIn; // e.g. "30d"
  return new Date(Date.now() + parseDuration(expiresIn));
}

/* ------------------------------------------------------------
   Parse "15m" / "30d" / "3600s" → milliseconds
   ------------------------------------------------------------ */
function parseDuration(str) {
  const match = String(str).match(/^(\d+)([smhd])$/);
  if (!match) return 30 * 24 * 60 * 60 * 1000; // default 30d

  const [, num, unit] = match;
  const n = parseInt(num, 10);

  switch (unit) {
    case 's': return n * 1000;
    case 'm': return n * 60 * 1000;
    case 'h': return n * 60 * 60 * 1000;
    case 'd': return n * 24 * 60 * 60 * 1000;
    default:  return n * 1000;
  }
}

module.exports = {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  decodeUnsafe,
  getRefreshExpiryDate,
};