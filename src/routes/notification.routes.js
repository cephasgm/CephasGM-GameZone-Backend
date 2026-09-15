/**
 * ============================================================
 * CephasGM GameZone — Notification Routes
 * ============================================================
 * Mounted at /api/v1/notifications
 * ============================================================
 */

'use strict';

const express = require('express');
const router = express.Router();

const notificationController = require('../controllers/notification.controller');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const {
  listNotificationsSchema,
  notificationIdParamSchema,
} = require('../validators/notification.validator');

router.use(requireAuth);

router.get('/', validate({ query: listNotificationsSchema }), notificationController.list);
router.post('/read-all', notificationController.markAllRead);
router.post('/:id/read', validate({ params: notificationIdParamSchema }), notificationController.markRead);
router.delete('/:id', validate({ params: notificationIdParamSchema }), notificationController.remove);

module.exports = router;