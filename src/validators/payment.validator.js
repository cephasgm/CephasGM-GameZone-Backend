/**
 * ============================================================
 * CephasGM GameZone — Payment Validators
 * ============================================================
 */

'use strict';

const { z } = require('zod');

const paymentMethodEnum = z.enum([
  'MPESA', 'TIGO_PESA', 'AIRTEL_MONEY', 'FLUTTERWAVE',
  'CARD', 'BANK_TRANSFER', 'CRYPTO',
]);

const phoneField = z
  .string()
  .trim()
  .regex(/^\+?[1-9]\d{6,14}$/, 'Please provide a valid phone number')
  .optional();

/* POST /deposits */
const initiateDepositSchema = z.object({
  amount: z.coerce.number().positive('Amount must be positive'),
  method: paymentMethodEnum,
  phone: phoneField,
  email: z.string().email().optional(),
  accountNumber: z.string().trim().max(50).optional(),
});

/* POST /withdrawals */
const requestWithdrawalSchema = z.object({
  amount: z.coerce.number().positive('Amount must be positive'),
  method: paymentMethodEnum,
  phone: phoneField,
  accountName: z.string().trim().max(100).optional(),
  bankName: z.string().trim().max(100).optional(),
});

/* GET /deposits — query */
const listPaymentsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(['PENDING', 'COMPLETED', 'FAILED', 'CANCELLED', 'REVERSED']).optional(),
});

/* Path param — reference */
const referenceParamSchema = z.object({
  reference: z.string().min(4).max(64),
});

/* POST /withdrawals/:reference/approve — admin only */
const approveWithdrawalSchema = z.object({
  note: z.string().trim().max(500).optional(),
});

/* POST /withdrawals/:reference/reject — admin only */
const rejectWithdrawalSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

module.exports = {
  initiateDepositSchema,
  requestWithdrawalSchema,
  listPaymentsSchema,
  referenceParamSchema,
  approveWithdrawalSchema,
  rejectWithdrawalSchema,
};