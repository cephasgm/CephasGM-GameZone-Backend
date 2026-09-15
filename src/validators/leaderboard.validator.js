/**
 * ============================================================
 * CephasGM GameZone — Leaderboard Validators
 * ============================================================
 */

'use strict';

const { z } = require('zod');

const leaderboardQuerySchema = z.object({
  period: z.enum(['daily', 'weekly', 'monthly', 'alltime']).default('weekly'),
  metric: z.enum(['winnings', 'wagered', 'referrals', 'vipPoints']).default('winnings'),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

module.exports = { leaderboardQuerySchema };