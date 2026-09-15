/**
 * ============================================================
 * CephasGM GameZone — Auth Controller
 * ============================================================
 * Thin HTTP layer. Parses requests, calls the service, and
 * returns responses via apiResponse helpers.
 * ============================================================
 */

'use strict';

const authService = require('../services/auth.service');
const apiResponse = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');
const { AppError } = require('../utils/AppError');

/* POST /auth/register */
const register = asyncHandler(async (req, res) => {
  const user = await authService.register(req.body, req);
  return apiResponse.created(
    res,
    user,
    'Account created. Please check your email/phone for the verification code.'
  );
});

/* POST /auth/login */
const login = asyncHandler(async (req, res) => {
  const result = await authService.login(req.body, req);
  return apiResponse.ok(res, result, 'Login successful');
});

/* POST /auth/refresh */
const refresh = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  const result = await authService.refresh(refreshToken, req);
  return apiResponse.ok(res, result);
});

/* POST /auth/logout */
const logout = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  await authService.logout(refreshToken);
  return apiResponse.ok(res, null, 'Logged out successfully');
});

/* POST /auth/verify-email */
const verifyEmail = asyncHandler(async (req, res) => {
  const user = await authService.verifyEmail(req.body);
  return apiResponse.ok(res, user, 'Email verified successfully');
});

/* POST /auth/resend-verification */
const resendVerification = asyncHandler(async (req, res) => {
  await authService.resendVerification(req.body);
  return apiResponse.ok(
    res,
    null,
    'If that email is registered, a new verification code has been sent.'
  );
});

/* POST /auth/forgot-password */
const forgotPassword = asyncHandler(async (req, res) => {
  await authService.forgotPassword(req.body);
  return apiResponse.ok(
    res,
    null,
    'If that email is registered, a password reset code has been sent.'
  );
});

/* POST /auth/reset-password */
const resetPassword = asyncHandler(async (req, res) => {
  await authService.resetPassword(req.body);
  return apiResponse.ok(res, null, 'Password reset successfully. Please log in.');
});

/* POST /auth/change-password (authenticated) */
const changePassword = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');
  await authService.changePassword(req.user.id, req.body);
  return apiResponse.ok(res, null, 'Password changed successfully');
});

/* GET /auth/me */
const getMe = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');
  const user = await authService.getMe(req.user.id);
  return apiResponse.ok(res, user);
});

module.exports = {
  register,
  login,
  refresh,
  logout,
  verifyEmail,
  resendVerification,
  forgotPassword,
  resetPassword,
  changePassword,
  getMe,
};