/**
 * ============================================================
 * CephasGM GameZone — Notification Validators
 * ============================================================
 */

'use strict';

const { z } = require('zod');

const listNotificationsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  unreadOnly: z.coerce.boolean().default(false),
  type: z
    .enum(['SYSTEM', 'BET_SETTLED', 'DEPOSIT', 'WITHDRAWAL', 'BONUS', 'KYC', 'PROMO', 'SECURITY'])
    .optional(),
});

const notificationIdParamSchema = z.object({
  id: z.string().min(1).max(64),
});

module.exports = {
  listNotificationsSchema,
  notificationIdParamSchema,
};