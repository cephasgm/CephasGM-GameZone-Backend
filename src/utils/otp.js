/**
 * ============================================================
 * CephasGM GameZone — OTP Utilities
 * ============================================================
 * Generates 6-digit numeric OTPs, hashes them for storage,
 * and compares submitted codes against stored hashes.
 *
 * Never store OTPs in plaintext — the hash goes in DB, the
 * plaintext goes only to the user (SMS or email).
 * ============================================================
 */

'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const config = require('../config');

const OTP_LENGTH = config.otp?.length || 6;

/**
 * Generate a random numeric OTP of configured length.
 * Returns a zero-padded string (e.g. "042815").
 */
function generateOTP() {
  const max = Math.pow(10, OTP_LENGTH);
  const randomBuffer = crypto.randomBytes(4);
  const randomInt = randomBuffer.readUInt32BE(0) % max;
  return String(randomInt).padStart(OTP_LENGTH, '0');
}

/**
 * Hash an OTP for storage.
 * Uses bcrypt with fewer rounds than passwords since OTPs are short-lived.
 */
async function hashOTP(otp) {
  return bcrypt.hash(String(otp), 8);
}

/**
 * Compare a plaintext OTP against a stored hash.
 */
async function compareOTP(otp, hash) {
  if (!otp || !hash) return false;
  return bcrypt.compare(String(otp), hash);
}

/**
 * Return the expiry Date for an OTP (config.otp.expiresMinutes).
 */
function getOTPExpiry() {
  const minutes = config.otp?.expiresMinutes || 10;
  return new Date(Date.now() + minutes * 60 * 1000);
}

/**
 * Check whether a stored OTP has expired.
 */
function isOTPExpired(expiresAt) {
  if (!expiresAt) return true;
  return new Date(expiresAt).getTime() < Date.now();
}

module.exports = {
  generateOTP,
  hashOTP,
  compareOTP,
  getOTPExpiry,
  isOTPExpired,
  OTP_LENGTH,
};