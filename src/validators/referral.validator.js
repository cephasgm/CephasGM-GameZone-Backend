/**
 * ============================================================
 * CephasGM GameZone — Referral Validators
 * ============================================================
 */

'use strict';

const { z } = require('zod');

const listReferralsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

module.exports = {
  listReferralsQuerySchema,
};