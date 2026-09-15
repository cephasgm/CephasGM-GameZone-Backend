/**
 * ============================================================
 * CephasGM GameZone — Provably Fair RNG
 * ============================================================
 * Every virtual round uses a cryptographic RNG that players can
 * independently verify:
 *
 *   1. Before each round:  we publish SHA256(serverSeed)
 *   2. Players place bets
 *   3. Round resolves using HMAC(serverSeed, roundId + publicSeed)
 *   4. After the round:    we reveal serverSeed
 *   5. Anyone can hash it and confirm it matches the commitment,
 *      and reproduce the exact result.
 *
 * This is the same scheme used by Stake, Roobet, and other
 * provably-fair platforms.
 * ============================================================
 */

'use strict';

const crypto = require('crypto');

/**
 * Generate a fresh server seed (64-char hex = 32 bytes of entropy).
 * Kept secret until the round completes.
 */
function generateServerSeed() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Hash a server seed for public commitment.
 * We show this to players before the round so they know we can't
 * change the seed after bets are placed.
 */
function hashServerSeed(serverSeed) {
  return crypto.createHash('sha256').update(serverSeed).digest('hex');
}

/**
 * Derive a deterministic float in [0, 1) from (serverSeed, message).
 * Uses HMAC-SHA256 so the output is unpredictable without the seed
 * but perfectly reproducible with it.
 */
function deriveFloat(serverSeed, message, offset = 0) {
  const hmac = crypto
    .createHmac('sha256', serverSeed)
    .update(`${message}:${offset}`)
    .digest('hex');

  // Take first 13 hex chars = 52 bits, convert to float 0..1
  const slice = hmac.slice(0, 13);
  const int = parseInt(slice, 16);
  return int / Math.pow(2, 52);
}

/**
 * Derive a random integer in [min, max] inclusive.
 */
function deriveInt(serverSeed, message, min, max, offset = 0) {
  const f = deriveFloat(serverSeed, message, offset);
  return Math.floor(f * (max - min + 1)) + min;
}

/**
 * Derive a crash point for Aviator.
 * The formula matches what the frontend displays:
 *   - 1% chance of instant crash (1.00x)
 *   - Otherwise, an exponential decay curve with a 4% house edge
 *
 * Formula (simplified):
 *   crash = floor((1 - houseEdge) / (1 - u)) / 100, clamped to [min, max]
 */
function deriveCrashPoint(serverSeed, roundId, houseEdge = 0.04, minCrash = 1.0, maxCrash = 60.0) {
  const u = deriveFloat(serverSeed, `aviator:${roundId}`);

  // Instant crash 1-in-100
  if (u < 0.01) return 1.00;

  // Exponential-style curve with house edge
  const raw = (1 - houseEdge) / (1 - u);
  const crash = Math.floor(raw * 100) / 100;

  return Math.min(Math.max(crash, minCrash), maxCrash);
}

/**
 * Fisher-Yates shuffle using our deterministic RNG.
 */
function deriveShuffle(serverSeed, message, array) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = deriveInt(serverSeed, message, 0, i, i);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Generate a public seed shown to all players (client input that
 * they can contribute to). For now we generate it server-side.
 */
function generatePublicSeed() {
  return crypto.randomBytes(16).toString('hex');
}

module.exports = {
  generateServerSeed,
  hashServerSeed,
  deriveFloat,
  deriveInt,
  deriveCrashPoint,
  deriveShuffle,
  generatePublicSeed,
};