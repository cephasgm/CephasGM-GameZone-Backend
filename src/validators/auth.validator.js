/**
 * ============================================================
 * CephasGM GameZone — Auth Validators
 * ============================================================
 * Zod schemas for every auth endpoint. The `validate` middleware
 * runs these before requests reach the controller.
 * ============================================================
 */

'use strict';

const { z } = require('zod');

/* ------------------------------------------------------------
   Reusable field validators
   ------------------------------------------------------------ */
const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .email('Please provide a valid email address')
  .max(255, 'Email is too long');

const phoneField = z
  .string()
  .trim()
  .regex(/^\+?[1-9]\d{6,14}$/, 'Please provide a valid phone number (E.164 format)');

const passwordField = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password is too long')
  .regex(/[A-Za-z]/, 'Password must contain at least one letter')
  .regex(/\d/, 'Password must contain at least one number');

const otpField = z
  .string()
  .trim()
  .regex(/^\d{4,8}$/, 'OTP must be a numeric code');

/* ------------------------------------------------------------
   POST /auth/register
   ------------------------------------------------------------ */
const registerSchema = z
  .object({
    fullName: z.string().trim().min(2, 'Full name is required').max(100),
    email: emailField.optional(),
    phone: phoneField.optional(),
    password: passwordField,
    confirmPassword: z.string(),
    referralCode: z.string().trim().toUpperCase().max(20).optional(),
    country: z.string().trim().length(2).toUpperCase().default('TZ'),
    currency: z.string().trim().length(3).toUpperCase().default('TZS'),
    acceptsTerms: z.boolean().refine((v) => v === true, {
      message: 'You must accept the terms and conditions',
    }),
  })
  .refine((d) => d.email || d.phone, {
    message: 'Either email or phone is required',
    path: ['email'],
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

/* ------------------------------------------------------------
   POST /auth/login
   ------------------------------------------------------------ */
const loginSchema = z
  .object({
    email: emailField.optional(),
    phone: phoneField.optional(),
    password: z.string().min(1, 'Password is required'),
  })
  .refine((d) => d.email || d.phone, {
    message: 'Email or phone is required',
    path: ['email'],
  });

/* ------------------------------------------------------------
   POST /auth/verify-email
   ------------------------------------------------------------ */
const verifyEmailSchema = z.object({
  email: emailField,
  otp: otpField,
});

/* ------------------------------------------------------------
   POST /auth/resend-verification
   ------------------------------------------------------------ */
const resendVerificationSchema = z.object({
  email: emailField,
});

/* ------------------------------------------------------------
   POST /auth/forgot-password
   ------------------------------------------------------------ */
const forgotPasswordSchema = z.object({
  email: emailField,
});

/* ------------------------------------------------------------
   POST /auth/reset-password
   ------------------------------------------------------------ */
const resetPasswordSchema = z
  .object({
    email: emailField,
    otp: otpField,
    newPassword: passwordField,
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

/* ------------------------------------------------------------
   POST /auth/refresh
   ------------------------------------------------------------ */
const refreshSchema = z.object({
  refreshToken: z.string().min(20, 'Refresh token is required'),
});

/* ------------------------------------------------------------
   POST /auth/change-password  (authenticated)
   ------------------------------------------------------------ */
const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: passwordField,
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

module.exports = {
  registerSchema,
  loginSchema,
  verifyEmailSchema,
  resendVerificationSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  refreshSchema,
  changePasswordSchema,
};