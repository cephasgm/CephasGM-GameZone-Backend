/**
 * ============================================================
 * CephasGM GameZone — Admin Validators
 * ============================================================
 */

'use strict';

const { z } = require('zod');

/* GET /admin/users — filters */
const listUsersSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().max(100).optional(),
  status: z.enum(['PENDING', 'ACTIVE', 'SUSPENDED', 'BANNED', 'CLOSED']).optional(),
  role: z.enum(['USER', 'ADMIN', 'SUPERADMIN']).optional(),
  kycStatus: z.enum(['NOT_SUBMITTED', 'PENDING', 'APPROVED', 'REJECTED']).optional(),
  vipTier: z.enum(['BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND']).optional(),
});

const userIdParamSchema = z.object({
  userId: z.string().min(1).max(64),
});

/* PATCH /admin/users/:userId/status */
const updateUserStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED', 'BANNED', 'CLOSED']),
  reason: z.string().trim().max(500).optional(),
});

/* PATCH /admin/users/:userId/role */
const updateUserRoleSchema = z.object({
  role: z.enum(['USER', 'ADMIN', 'SUPERADMIN']),
});

/* POST /admin/users/:userId/adjust-balance */
const adjustBalanceSchema = z.object({
  amount: z.coerce.number().refine((v) => v !== 0, 'Amount cannot be zero'),
  currency: z.string().length(3).toUpperCase().optional(),
  reason: z.string().trim().min(3).max(500),
  type: z.enum(['CREDIT', 'DEBIT']),
});

/* GET /admin/audit-logs */
const listAuditLogsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  action: z.string().trim().max(100).optional(),
  actorId: z.string().trim().max(64).optional(),
  targetId: z.string().trim().max(64).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

module.exports = {
  listUsersSchema,
  userIdParamSchema,
  updateUserStatusSchema,
  updateUserRoleSchema,
  adjustBalanceSchema,
  listAuditLogsSchema,
};