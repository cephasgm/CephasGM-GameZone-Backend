/**
 * ============================================================
 * CephasGM GameZone — Support Routes
 * ============================================================
 * Mounted at /api/v1/support
 * ============================================================
 */

'use strict';

const express = require('express');
const router = express.Router();

const supportController = require('../controllers/support.controller');
const { requireAuth } = require('../middleware/auth');
const { adminOnly } = require('../middleware/adminOnly');
const { validate } = require('../middleware/validate');
const {
  createTicketSchema,
  replyTicketSchema,
  listTicketsSchema,
  ticketIdParamSchema,
  adminUpdateTicketSchema,
} = require('../validators/support.validator');

router.use(requireAuth);

/* ---------- ADMIN routes (before /:id to avoid conflict) ---------- */
router.get('/admin', adminOnly, validate({ query: listTicketsSchema }), supportController.adminList);
router.get('/admin/:id', adminOnly, validate({ params: ticketIdParamSchema }), supportController.adminGet);
router.post(
  '/admin/:id/reply',
  adminOnly,
  validate({ params: ticketIdParamSchema, body: replyTicketSchema }),
  supportController.adminReply
);
router.patch(
  '/admin/:id',
  adminOnly,
  validate({ params: ticketIdParamSchema, body: adminUpdateTicketSchema }),
  supportController.adminUpdate
);

/* ---------- USER routes ---------- */
router.post('/', validate(createTicketSchema), supportController.create);
router.get('/', validate({ query: listTicketsSchema }), supportController.listMine);
router.get('/:id', validate({ params: ticketIdParamSchema }), supportController.getOne);
router.post(
  '/:id/reply',
  validate({ params: ticketIdParamSchema, body: replyTicketSchema }),
  supportController.reply
);
router.post('/:id/close', validate({ params: ticketIdParamSchema }), supportController.close);

module.exports = router;