/**
 * ============================================================
 * CephasGM GameZone — User Controller
 * ============================================================
 */

'use strict';

const userService = require('../services/user.service');
const apiResponse = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');
const { AppError } = require('../utils/AppError');

/* GET /users/me */
const getMe = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');
  const user = await userService.getProfile(req.user.id);
  return apiResponse.ok(res, user);
});

/* PATCH /users/me */
const updateMe = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');
  const user = await userService.updateProfile(req.user.id, req.body);
  return apiResponse.ok(res, user, 'Profile updated');
});

/* PATCH /users/me/settings */
const updateSettings = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');
  const user = await userService.updateSettings(req.user.id, req.body);
  return apiResponse.ok(res, user, 'Settings updated');
});

/* DELETE /users/me — deactivate account */
const deactivate = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');
  await userService.deactivateAccount(req.user.id);
  return apiResponse.ok(res, null, 'Account deactivated');
});

module.exports = {
  getMe,
  updateMe,
  updateSettings,
  deactivate,
};