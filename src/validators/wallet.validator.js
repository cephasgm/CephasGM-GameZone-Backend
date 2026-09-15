/**
 * ============================================================
 * CephasGM GameZone — Wallet & Transaction Validators
 * ============================================================
 */

'use strict';

const { z } = require('zod');

const txTypeEnum = z.enum([
  'DEPOSIT', 'WITHDRAWAL', 'BET_PLACED', 'BET_WON', 'BET_REFUND',
  'BONUS_CREDIT', 'BONUS_WAGER', 'REFERRAL_COMMISSION', 'ADJUSTMENT', 'FEE',
]);

const txStatusEnum = z.enum([
  'PENDING', 'COMPLETED', 'FAILED', 'CANCELLED', 'REVERSED',
]);

const dateString = z.string().datetime({ offset: true }).optional();

/* GET /wallet/transactions — query filters */
const listTransactionsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  type: txTypeEnum.optional(),
  status: txStatusEnum.optional(),
  from: dateString,
  to: dateString,
});

/* GET /wallet/summary — date range */
const summarySchema = z.object({
  from: dateString,
  to: dateString,
});

/* GET /wallet/transactions/:reference — path param */
const referenceParamSchema = z.object({
  reference: z.string().min(4).max(64),
});

module.exports = {
  listTransactionsSchema,
  summarySchema,
  referenceParamSchema,
};