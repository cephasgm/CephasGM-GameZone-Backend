/**
 * ============================================================
 * CephasGM GameZone — Reference ID Generator
 * ============================================================
 * Produces short, unique, human-readable reference strings for
 * every transaction, deposit, withdrawal, and bet.
 *
 * Format: PREFIX-YYYYMMDD-RANDOM
 * Example: DEP-20250915-A3F7K9
 * ============================================================
 */

'use strict';

const crypto = require('crypto');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L to avoid confusion

/**
 * Generate a random alphanumeric segment of given length.
 */
function randomSegment(length = 6) {
  let result = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    result += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return result;
}

/**
 * Return YYYYMMDD string for today (UTC).
 */
function todayStamp() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

/**
 * Main generator.
 * @param {string} prefix — e.g. 'DEP', 'WTH', 'BET', 'TXN', 'REF'
 * @param {number} length — random segment length (default 6)
 */
function generateRef(prefix = 'REF', length = 6) {
  return `${prefix.toUpperCase()}-${todayStamp()}-${randomSegment(length)}`;
}

/* ------------------------------------------------------------
   Convenience wrappers for each domain
   ------------------------------------------------------------ */
const refs = {
  deposit:    () => generateRef('DEP'),
  withdrawal: () => generateRef('WTH'),
  bet:        () => generateRef('BET'),
  transaction:() => generateRef('TXN'),
  referral:   () => generateRef('REF'),
  session:    () => generateRef('SES', 12),
  ticket:     () => generateRef('TKT'),
};

module.exports = {
  generateRef,
  ...refs,
};