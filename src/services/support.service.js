/**
 * ============================================================
 * CephasGM GameZone — Support Service
 * ============================================================
 * Customer support ticket system.
 *
 * Users can:
 *   • Open a ticket with an initial message
 *   • Reply to their own tickets
 *   • Close their own tickets
 *   • See status and message history
 *
 * Admins can:
 *   • List all tickets
 *   • Reply as staff
 *   • Update status/priority/assignee
 * ============================================================
 */

'use strict';

const prisma = require('../config/database');
const logger = require('../config/logger');
const { AppError } = require('../utils/AppError');
const notificationService = require('./notification.service');

/* ============================================================
   USER OPERATIONS
   ============================================================ */

async function createTicket(userId, { subject, category, priority, message, attachments }) {
  const result = await prisma.$transaction(async (tx) => {
    const ticket = await tx.supportTicket.create({
      data: {
        userId,
        subject,
        category: category || null,
        priority,
        status: 'OPEN',
      },
    });

    await tx.ticketMessage.create({
      data: {
        ticketId: ticket.id,
        userId,
        isStaff: false,
        message,
        attachments: attachments || undefined,
      },
    });

    return ticket;
  });

  /* Notify the user (confirmation) */
  await notificationService.notify(userId, {
    type: 'SYSTEM',
    title: 'Support ticket created',
    message: `We've received your ticket "${subject}". Our team will respond shortly.`,
    data: { ticketId: result.id },
  });

  logger.info({ userId, ticketId: result.id, subject }, '🎫 Support ticket created');

  return getTicket(userId, result.id, false);
}

async function listMyTickets(userId, { page = 1, limit = 20, status } = {}) {
  const skip = (page - 1) * limit;
  const where = { userId };
  if (status) where.status = status;

  const [items, total] = await Promise.all([
    prisma.supportTicket.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip,
      take: limit,
      include: { _count: { select: { messages: true } } },
    }),
    prisma.supportTicket.count({ where }),
  ]);

  return {
    items: items.map((t) => ({
      id: t.id,
      subject: t.subject,
      category: t.category,
      status: t.status,
      priority: t.priority,
      messageCount: t._count.messages,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    })),
    pagination: { page, limit, total },
  };
}

async function getTicket(userId, ticketId, isAdmin = false) {
  const ticket = await prisma.supportTicket.findUnique({
    where: { id: ticketId },
    include: {
      messages: {
        orderBy: { createdAt: 'asc' },
        include: {
          user: { select: { id: true, username: true, fullName: true } },
        },
      },
    },
  });

  if (!ticket) throw new AppError('Ticket not found', 404, 'TICKET_NOT_FOUND');
  if (!isAdmin && ticket.userId !== userId) {
    throw new AppError('Not your ticket', 403, 'FORBIDDEN');
  }

  return {
    id: ticket.id,
    userId: ticket.userId,
    subject: ticket.subject,
    category: ticket.category,
    status: ticket.status,
    priority: ticket.priority,
    assignedTo: ticket.assignedTo,
    closedAt: ticket.closedAt,
    messages: ticket.messages.map((m) => ({
      id: m.id,
      userId: m.userId,
      username: m.user?.username || null,
      isStaff: m.isStaff,
      message: m.message,
      attachments: m.attachments,
      createdAt: m.createdAt,
    })),
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
  };
}

async function reply(userId, ticketId, { message, attachments }, isStaff = false) {
  const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw new AppError('Ticket not found', 404, 'TICKET_NOT_FOUND');
  if (!isStaff && ticket.userId !== userId) {
    throw new AppError('Not your ticket', 403, 'FORBIDDEN');
  }
  if (ticket.status === 'CLOSED') {
    throw new AppError('Cannot reply to a closed ticket', 400, 'TICKET_CLOSED');
  }

  await prisma.$transaction(async (tx) => {
    await tx.ticketMessage.create({
      data: {
        ticketId,
        userId,
        isStaff,
        message,
        attachments: attachments || undefined,
      },
    });

    /* Reopen if it was pending/resolved and user replies */
    const newStatus = isStaff ? 'PENDING' : 'OPEN';
    await tx.supportTicket.update({
      where: { id: ticketId },
      data: { status: newStatus },
    });
  });

  /* Notify the ticket owner if a staff member replies */
  if (isStaff) {
    await notificationService.notify(ticket.userId, {
      type: 'SYSTEM',
      title: 'Support replied to your ticket',
      message: `An agent has responded to "${ticket.subject}".`,
      data: { ticketId },
    });
  }

  return getTicket(userId, ticketId, isStaff);
}

async function closeTicket(userId, ticketId) {
  const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw new AppError('Ticket not found', 404, 'TICKET_NOT_FOUND');
  if (ticket.userId !== userId) throw new AppError('Not your ticket', 403, 'FORBIDDEN');

  await prisma.supportTicket.update({
    where: { id: ticketId },
    data: { status: 'CLOSED', closedAt: new Date() },
  });

  return { closed: true };
}

/* ============================================================
   ADMIN OPERATIONS
   ============================================================ */

async function adminListTickets({ page = 1, limit = 20, status, priority } = {}) {
  const skip = (page - 1) * limit;
  const where = {};
  if (status) where.status = status;
  if (priority) where.priority = priority;

  const [items, total] = await Promise.all([
    prisma.supportTicket.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip,
      take: limit,
      include: {
        user: { select: { id: true, email: true, username: true, fullName: true } },
        _count: { select: { messages: true } },
      },
    }),
    prisma.supportTicket.count({ where }),
  ]);

  return {
    items: items.map((t) => ({
      id: t.id,
      user: t.user,
      subject: t.subject,
      category: t.category,
      status: t.status,
      priority: t.priority,
      assignedTo: t.assignedTo,
      messageCount: t._count.messages,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    })),
    pagination: { page, limit, total },
  };
}

async function adminUpdateTicket(adminId, ticketId, { status, priority, assignedTo }) {
  const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw new AppError('Ticket not found', 404, 'TICKET_NOT_FOUND');

  const data = {};
  if (status) {
    data.status = status;
    if (status === 'CLOSED' || status === 'RESOLVED') data.closedAt = new Date();
  }
  if (priority) data.priority = priority;
  if (assignedTo) data.assignedTo = assignedTo;

  const updated = await prisma.supportTicket.update({
    where: { id: ticketId },
    data,
  });

  await prisma.auditLog.create({
    data: {
      actorId: adminId,
      action: 'TICKET_UPDATED',
      targetType: 'SupportTicket',
      targetId: ticketId,
      metadata: { status, priority, assignedTo },
    },
  }).catch(() => {});

  return { id: updated.id, status: updated.status, priority: updated.priority, assignedTo: updated.assignedTo };
}

module.exports = {
  createTicket,
  listMyTickets,
  getTicket,
  reply,
  closeTicket,
  adminListTickets,
  adminUpdateTicket,
};