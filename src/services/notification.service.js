/**
 * ============================================================
 * CephasGM GameZone — Notification Service
 * ============================================================
 * In-app notifications. Other services (deposit, withdrawal,
 * bet, kyc) call notify() to create a notification for a user.
 *
 * Also emits via Socket.io if the user is connected — real-time
 * toast updates on the frontend.
 * ============================================================
 */

'use strict';

const prisma = require('../config/database');
const logger = require('../config/logger');
const { AppError } = require('../utils/AppError');

/* ------------------------------------------------------------
   CREATOR — called by other services
   ------------------------------------------------------------ */
async function notify(userId, { type, title, message, data = null }) {
  if (!userId || !type || !title || !message) {
    logger.warn({ userId, type }, '⚠️  notify() called with missing args');
    return null;
  }

  const notification = await prisma.notification.create({
    data: {
      userId,
      type,
      title,
      message,
      data: data || undefined,
    },
  });

  /* Emit via Socket.io if the global io is set */
  try {
    const io = global.__io;
    if (io) {
      io.to(`user:${userId}`).emit('notification', publicNotification(notification));
    }
  } catch (err) {
    logger.debug({ err: err.message }, 'Socket emit for notification failed');
  }

  return publicNotification(notification);
}

/* ------------------------------------------------------------
   LIST
   ------------------------------------------------------------ */
async function list(userId, { page = 1, limit = 20, unreadOnly = false, type } = {}) {
  const skip = (page - 1) * limit;
  const where = { userId };
  if (unreadOnly) where.isRead = false;
  if (type) where.type = type;

  const [items, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId, isRead: false } }),
  ]);

  return {
    items: items.map(publicNotification),
    unreadCount,
    pagination: { page, limit, total },
  };
}

/* ------------------------------------------------------------
   MARK ONE AS READ
   ------------------------------------------------------------ */
async function markRead(userId, id) {
  const notification = await prisma.notification.findUnique({ where: { id } });
  if (!notification || notification.userId !== userId) {
    throw new AppError('Notification not found', 404, 'NOTIFICATION_NOT_FOUND');
  }
  if (notification.isRead) return publicNotification(notification);

  const updated = await prisma.notification.update({
    where: { id },
    data: { isRead: true, readAt: new Date() },
  });

  return publicNotification(updated);
}

/* ------------------------------------------------------------
   MARK ALL AS READ
   ------------------------------------------------------------ */
async function markAllRead(userId) {
  const result = await prisma.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true, readAt: new Date() },
  });
  return { updated: result.count };
}

/* ------------------------------------------------------------
   DELETE
   ------------------------------------------------------------ */
async function remove(userId, id) {
  const notification = await prisma.notification.findUnique({ where: { id } });
  if (!notification || notification.userId !== userId) {
    throw new AppError('Notification not found', 404, 'NOTIFICATION_NOT_FOUND');
  }
  await prisma.notification.delete({ where: { id } });
  return { deleted: true };
}

/* ------------------------------------------------------------
   PUBLIC SHAPE
   ------------------------------------------------------------ */
function publicNotification(n) {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    message: n.message,
    data: n.data,
    isRead: n.isRead,
    readAt: n.readAt,
    createdAt: n.createdAt,
  };
}

module.exports = {
  notify,
  list,
  markRead,
  markAllRead,
  remove,
  publicNotification,
};