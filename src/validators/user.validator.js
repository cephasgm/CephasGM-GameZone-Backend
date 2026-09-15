/**
 * ============================================================
 * CephasGM GameZone — User Validators
 * ============================================================
 */

'use strict';

const { z } = require('zod');

const updateProfileSchema = z.object({
  fullName: z.string().trim().min(2).max(100).optional(),
  username: z
    .string()
    .trim()
    .min(3)
    .max(30)
    .regex(/^[a-zA-Z0-9_]+$/, 'Only letters, numbers and underscore')
    .optional(),
  dateOfBirth: z.string().datetime({ offset: true }).optional(),
  country: z.string().trim().length(2).toUpperCase().optional(),
  city: z.string().trim().max(80).optional(),
  address: z.string().trim().max(200).optional(),
  language: z.string().trim().min(2).max(5).optional(),
  avatarUrl: z.string().url().max(500).optional(),
});

const updateSettingsSchema = z.object({
  currency: z.string().length(3).toUpperCase().optional(),
  language: z.string().min(2).max(5).optional(),
  marketingEmails: z.boolean().optional(),
  marketingSms: z.boolean().optional(),
  twoFactorEnabled: z.boolean().optional(),
});

module.exports = {
  updateProfileSchema,
  updateSettingsSchema,
};