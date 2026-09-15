/**
 * ============================================================
 * CephasGM GameZone — Bonus Validators
 * ============================================================
 */

'use strict';

const { z } = require('zod');

const claimBonusSchema = z.object({
  code: z.string().trim().toUpperCase().min(3).max(30),
});

const listBonusesQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(['ACTIVE', 'USED', 'EXPIRED', 'CANCELLED']).optional(),
});

module.exports = {
  claimBonusSchema,
  listBonusesQuerySchema,
};