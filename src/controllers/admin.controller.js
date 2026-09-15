/**
 * ============================================================
 * CephasGM GameZone — Admin Controller
 * ============================================================
 */

'use strict';

const adminService = require('../services/admin.service');
const apiResponse = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');
const { AppError } = require('../utils/AppError');

/* GET /admin/stats */
const dashboardStats = asyncHandler(async (req, res) => {
  const stats = await adminService.getDashboardStats();
  return apiResponse.ok(res, stats);
});

/* GET /admin/users */
const listUsers = asyncHandler(async (req, res) => {
  const result = await adminService.listUsers(req.query);
  return apiResponse.paginated(res, result.items, result.pagination);
});

/* GET /admin/users/:userId */
const getUser = asyncHandler(async (req, res) => {
  const user = await adminService.getUserDetail(req.params.userId);
  return apiResponse.ok(res, user);
});

/* PATCH /admin/users/:userId/status */
const updateUserStatus = asyncHandler(async (req, res) => {
  const result = await adminService.updateUserStatus(req.user.id, req.params.userId, req.body);
  return apiResponse.ok(res, result, `User status → ${req.body.status}`);
});

/* PATCH /admin/users/:userId/role */
const updateUserRole = asyncHandler(async (req, res) => {
  const result = await adminService.updateUserRole(req.user.id, req.params.userId, req.body);
  return apiResponse.ok(res, result, `User role → ${req.body.role}`);
});

/* POST /admin/users/:userId/adjust-balance */
const adjustBalance = asyncHandler(async (req, res) => {
  const result = await adminService.adjustBalance(req.user.id, req.params.userId, req.body);
  return apiResponse.ok(res, result, `Balance ${req.body.type.toLowerCase()}ed`);
});

/* GET /admin/audit-logs */
const listAuditLogs = asyncHandler(async (req, res) => {
  const result = await adminService.listAuditLogs(req.query);
  return apiResponse.paginated(res, result.items, result.pagination);
});

module.exports = {
  dashboardStats,
  listUsers,
  getUser,
  updateUserStatus,
  updateUserRole,
  adjustBalance,
  listAuditLogs,
};