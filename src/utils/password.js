/**
 * ============================================================
 * CephasGM GameZone — Password Utilities
 * ============================================================
 * bcrypt hashing with configurable rounds (default 12).
 * ============================================================
 */

'use strict';

const bcrypt = require('bcryptjs');
const config = require('../config');

const ROUNDS = config.bcryptRounds || 12;

/**
 * Hash a plaintext password.
 * @param {string} password
 * @returns {Promise<string>} bcrypt hash
 */
async function hashPassword(password) {
  if (!password || typeof password !== 'string') {
    throw new Error('Password must be a non-empty string');
  }
  return bcrypt.hash(password, ROUNDS);
}

/**
 * Compare a plaintext password against a bcrypt hash.
 * @param {string} password
 * @param {string} hash
 * @returns {Promise<boolean>}
 */
async function comparePassword(password, hash) {
  if (!password || !hash) return false;
  return bcrypt.compare(password, hash);
}

/**
 * Quick password strength check.
 * Must be 8+ chars, have a letter and a number.
 * @param {string} password
 * @returns {{ valid: boolean, reason?: string }}
 */
function validatePasswordStrength(password) {
  if (!password || password.length < 8) {
    return { valid: false, reason: 'Password must be at least 8 characters' };
  }
  if (!/[A-Za-z]/.test(password)) {
    return { valid: false, reason: 'Password must contain at least one letter' };
  }
  if (!/\d/.test(password)) {
    return { valid: false, reason: 'Password must contain at least one number' };
  }
  return { valid: true };
}

module.exports = {
  hashPassword,
  comparePassword,
  validatePasswordStrength,
};