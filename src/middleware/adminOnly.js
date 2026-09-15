/**
 * ============================================================
 * CephasGM GameZone — Admin Gate Middleware
 * ============================================================
 * Shortcut for requireRole(['ADMIN', 'SUPERADMIN']).
 * Kept as a separate file so admin routes read cleanly:
 *   router.get('/users', requireAuth, adminOnly, listUsers);
 * ============================================================
 */

'use strict';

const { requireRole } = require('./auth');

/**
 * Blocks the request unless req.user.role is ADMIN or SUPERADMIN.
 * Must be used AFTER requireAuth.
 */
const adminOnly = requireRole('ADMIN', 'SUPERADMIN');

/**
 * Stricter variant — only SUPERADMIN can pass.
 * Use for destructive actions: delete user, change balances, etc.
 */
const superAdminOnly = requireRole('SUPERADMIN');

module.exports = { adminOnly, superAdminOnly };