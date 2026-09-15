/**
 * ============================================================
 * CephasGM GameZone — Admin Routes
 * ============================================================
 * Mounted at /api/v1/admin
 * Every route requires authentication + ADMIN or SUPERADMIN role.
 * Destructive operations (role changes, super-admin) require SUPERADMIN.
 * ============================================================
 */

'use strict';

const express = require('express');
const router = express.Router();

const adminController = require('../controllers/admin.controller');
const { requireAuth } = require('../middleware/auth');
const { adminOnly, superAdminOnly } = require('../middleware/adminOnly');
const { validate } = require('../middleware/validate');
const {
  listUsersSchema,
  userIdParamSchema,
  updateUserStatusSchema,
  updateUserRoleSchema,
  adjustBalanceSchema,
  listAuditLogsSchema,
} = require('../validators/admin.validator');

router.use(requireAuth);
router.use(adminOnly);

/* Dashboard */
router.get('/stats', adminController.dashboardStats);

/* Users */
router.get('/users', validate({ query: listUsersSchema }), adminController.listUsers);
router.get('/users/:userId', validate({ params: userIdParamSchema }), adminController.getUser);
router.patch(
  '/users/:userId/status',
  validate({ params: userIdParamSchema, body: updateUserStatusSchema }),
  adminController.updateUserStatus
);
router.post(
  '/users/:userId/adjust-balance',
  validate({ params: userIdParamSchema, body: adjustBalanceSchema }),
  adminController.adjustBalance
);

/* Role changes — SUPERADMIN only */
router.patch(
  '/users/:userId/role',
  superAdminOnly,
  validate({ params: userIdParamSchema, body: updateUserRoleSchema }),
  adminController.updateUserRole
);

/* Audit logs */
router.get('/audit-logs', validate({ query: listAuditLogsSchema }), adminController.listAuditLogs);

module.exports = router;