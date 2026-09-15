/**
 * ============================================================
 * CephasGM GameZone — User Routes
 * ============================================================
 * Mounted at /api/v1/users
 * ============================================================
 */

'use strict';

const express = require('express');
const router = express.Router();

const userController = require('../controllers/user.controller');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const {
  updateProfileSchema,
  updateSettingsSchema,
} = require('../validators/user.validator');

router.use(requireAuth);

router.get('/me', userController.getMe);
router.patch('/me', validate(updateProfileSchema), userController.updateMe);
router.patch('/me/settings', validate(updateSettingsSchema), userController.updateSettings);
router.delete('/me', userController.deactivate);

module.exports = router;