/**
 * ============================================================
 * CephasGM GameZone — Support Validators
 * ============================================================
 */

'use strict';

const { z } = require('zod');

const createTicketSchema = z.object({
  subject: z.string().trim().min(3).max(200),
  category: z.string().trim().max(50).optional(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
  message: z.string().trim().min(5).max(5000),
  attachments: z.array(z.string().url()).max(5).optional(),
});

const replyTicketSchema = z.object({
  message: z.string().trim().min(1).max(5000),
  attachments: z.array(z.string().url()).max(5).optional(),
});

const listTicketsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(['OPEN', 'PENDING', 'RESOLVED', 'CLOSED']).optional(),
});

const ticketIdParamSchema = z.object({
  id: z.string().min(1).max(64),
});

const adminUpdateTicketSchema = z.object({
  status: z.enum(['OPEN', 'PENDING', 'RESOLVED', 'CLOSED']).optional(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional(),
  assignedTo: z.string().max(64).optional(),
});

module.exports = {
  createTicketSchema,
  replyTicketSchema,
  listTicketsSchema,
  ticketIdParamSchema,
  adminUpdateTicketSchema,
};