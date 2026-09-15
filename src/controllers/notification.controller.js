/**
 * ============================================================
 * CephasGM GameZone — Notification Controller
 * ============================================================
 */

'use strict';

const notificationService = require('../services/notification.service');
const apiResponse = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');
const { AppError } = require('../utils/AppError');

const list = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');
  const result = await notificationService.list(req.user.id, req.query);
  return res.status(200).json({
    success: true,
    data: result.items,
    unreadCount: result.unreadCount,
    meta: { pagination: result.pagination },
  });
});

const markRead = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');
  const n = await notificationService.markRead(req.user.id, req.params.id);
  return apiResponse.ok(res, n);
});

const markAllRead = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');
  const result = await notificationService.markAllRead(req.user.id);
  return apiResponse.ok(res, result, `Marked ${result.updated} notifications as read`);
});

const remove = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');
  await notificationService.remove(req.user.id, req.params.id);
  return apiResponse.ok(res, null, 'Notification removed');
});

module.exports = { list, markRead, markAllRead, remove };