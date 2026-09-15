/**
 * ============================================================
 * CephasGM GameZone — Admin Service
 * ============================================================
 * Platform-operations layer used only by admins/superadmins.
 * Every destructive action writes an AuditLog row.
 * ============================================================
 */

'use strict';

const Decimal = require('decimal.js');

const prisma = require('../config/database');
const logger = require('../config/logger');
const { AppError } = require('../utils/AppError');
const walletService = require('./wallet.service');
const { generateRef } = require('../utils/generateRef');

/* ============================================================
   DASHBOARD STATS
   ============================================================ */
async function getDashboardStats() {
  const [
    totalUsers,
    activeUsers,
    pendingKyc,
    totalDeposits,
    totalWithdrawals,
    totalBets,
    pendingWithdrawals,
    todaySignups,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { status: 'ACTIVE' } }),
    prisma.user.count({ where: { kycStatus: 'PENDING' } }),
    prisma.deposit.aggregate({ where: { status: 'COMPLETED' }, _sum: { amount: true } }),
    prisma.withdrawal.aggregate({ where: { status: 'COMPLETED' }, _sum: { amount: true } }),
    prisma.bet.aggregate({ _sum: { stake: true }, _count: true }),
    prisma.withdrawal.count({ where: { status: 'PENDING' } }),
    prisma.user.count({
      where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    }),
  ]);

  return {
    users: {
      total: totalUsers,
      active: activeUsers,
      pendingKyc,
      todaySignups,
    },
    money: {
      totalDeposited: (totalDeposits._sum.amount || 0).toString(),
      totalWithdrawn: (totalWithdrawals._sum.amount || 0).toString(),
      totalBetStake: (totalBets._sum.stake || 0).toString(),
      pendingWithdrawals,
    },
    bets: {
      total: totalBets._count,
    },
  };
}

/* ============================================================
   LIST USERS
   ============================================================ */
async function listUsers(filters) {
  const page = Math.max(1, parseInt(filters.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(filters.limit, 10) || 20));
  const skip = (page - 1) * limit;

  const where = {};
  if (filters.status) where.status = filters.status;
  if (filters.role) where.role = filters.role;
  if (filters.kycStatus) where.kycStatus = filters.kycStatus;
  if (filters.vipTier) where.vipTier = filters.vipTier;

  if (filters.search) {
    where.OR = [
      { email: { contains: filters.search, mode: 'insensitive' } },
      { phone: { contains: filters.search, mode: 'insensitive' } },
      { username: { contains: filters.search, mode: 'insensitive' } },
      { fullName: { contains: filters.search, mode: 'insensitive' } },
    ];
  }

  const [items, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      select: {
        id: true,
        email: true,
        phone: true,
        username: true,
        fullName: true,
        country: true,
        currency: true,
        role: true,
        status: true,
        kycStatus: true,
        vipTier: true,
        emailVerified: true,
        createdAt: true,
        lastLoginAt: true,
        wallets: { select: { currency: true, balance: true, lockedBalance: true } },
      },
    }),
    prisma.user.count({ where }),
  ]);

  return { items, pagination: { page, limit, total } };
}

/* ============================================================
   GET USER DETAIL
   ============================================================ */
async function getUserDetail(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      wallets: true,
      _count: {
        select: {
          bets: true,
          deposits: true,
          withdrawals: true,
          sessions: true,
        },
      },
    },
  });
  if (!user) throw new AppError('User not found', 404, 'USER_NOT_FOUND');

  /* Remove sensitive fields */
  delete user.passwordHash;
  delete user.twoFactorSecret;

  return user;
}

/* ============================================================
   UPDATE USER STATUS
   ============================================================ */
async function updateUserStatus(adminId, userId, { status, reason }) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError('User not found', 404, 'USER_NOT_FOUND');

  if (user.role === 'SUPERADMIN' && status !== 'ACTIVE') {
    throw new AppError('Cannot suspend/ban a superadmin', 400, 'CANNOT_MODIFY_SUPERADMIN');
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { status },
    });

    /* If suspending/banning/closing, revoke sessions */
    if (status !== 'ACTIVE') {
      await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    await tx.auditLog.create({
      data: {
        actorId: adminId,
        action: `USER_${status}`,
        targetType: 'User',
        targetId: userId,
        metadata: reason ? { reason, previousStatus: user.status } : { previousStatus: user.status },
      },
    });
  });

  logger.info({ adminId, userId, status, reason }, '🔨 User status updated');
  return { userId, status };
}

/* ============================================================
   UPDATE USER ROLE
   ============================================================ */
async function updateUserRole(adminId, userId, { role }) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError('User not found', 404, 'USER_NOT_FOUND');

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { role } });
    await tx.auditLog.create({
      data: {
        actorId: adminId,
        action: 'USER_ROLE_CHANGED',
        targetType: 'User',
        targetId: userId,
        metadata: { previousRole: user.role, newRole: role },
      },
    });
  });

  logger.info({ adminId, userId, role }, '🔨 User role updated');
  return { userId, role };
}

/* ============================================================
   ADJUST BALANCE
   ------------------------------------------------------------
   Manual credit/debit — for refunds, corrections, goodwill.
   Every adjustment creates a Transaction row via wallet service
   AND an AuditLog row.
   ============================================================ */
async function adjustBalance(adminId, userId, { amount, type, currency, reason }) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError('User not found', 404, 'USER_NOT_FOUND');

  const amt = new Decimal(amount).abs();

  const walletServiceCall = type === 'CREDIT'
    ? walletService.credit
    : walletService.debit;

  const result = await walletServiceCall(userId, amt.toString(), {
    type: 'ADJUSTMENT',
    description: `Admin ${type}: ${reason}`,
    reference: generateRef('TXN'),
    currency: currency || user.currency,
    metadata: { adminId, reason },
  });

  await prisma.auditLog.create({
    data: {
      actorId: adminId,
      action: `BALANCE_${type}`,
      targetType: 'User',
      targetId: userId,
      metadata: {
        amount: amt.toString(),
        currency: currency || user.currency,
        reason,
        newBalance: result.balance,
      },
    },
  });

  logger.info(
    { adminId, userId, type, amount: amt.toString(), reason },
    '💰 Admin balance adjustment'
  );

  return {
    userId,
    type,
    amount: amt.toString(),
    newBalance: result.balance,
    reference: result.transaction.reference,
  };
}

/* ============================================================
   AUDIT LOGS
   ============================================================ */
async function listAuditLogs(filters) {
  const page = Math.max(1, parseInt(filters.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(filters.limit, 10) || 50));
  const skip = (page - 1) * limit;

  const where = {};
  if (filters.action) where.action = filters.action;
  if (filters.actorId) where.actorId = filters.actorId;
  if (filters.targetId) where.targetId = filters.targetId;
  if (filters.from || filters.to) {
    where.createdAt = {};
    if (filters.from) where.createdAt.gte = new Date(filters.from);
    if (filters.to) where.createdAt.lte = new Date(filters.to);
  }

  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: {
        actor: { select: { id: true, email: true, username: true } },
      },
    }),
    prisma.auditLog.count({ where }),
  ]);

  return { items, pagination: { page, limit, total } };
}

module.exports = {
  getDashboardStats,
  listUsers,
  getUserDetail,
  updateUserStatus,
  updateUserRole,
  adjustBalance,
  listAuditLogs,
};