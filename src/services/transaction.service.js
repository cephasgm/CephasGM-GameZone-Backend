/**
 * ============================================================
 * CephasGM GameZone — Transaction Service
 * ============================================================
 * Read-only queries against the immutable ledger.
 * The write side lives in wallet.service.js (each wallet change
 * creates a transaction row in the same DB transaction).
 * ============================================================
 */

'use strict';

const prisma = require('../config/database');
const { AppError } = require('../utils/AppError');
const Decimal = require('decimal.js');

/* ============================================================
   LIST — paginated, filterable
   ============================================================ */
async function listTransactions(userId, filters = {}) {
  const page = Math.max(1, parseInt(filters.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(filters.limit, 10) || 20));
  const skip = (page - 1) * limit;

  const where = { userId };
  if (filters.type) where.type = filters.type;
  if (filters.status) where.status = filters.status;

  if (filters.from || filters.to) {
    where.createdAt = {};
    if (filters.from) where.createdAt.gte = new Date(filters.from);
    if (filters.to) where.createdAt.lte = new Date(filters.to);
  }

  const [items, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.transaction.count({ where }),
  ]);

  return {
    items: items.map(publicTxn),
    pagination: { page, limit, total },
  };
}

/* ============================================================
   SINGLE — by reference
   ============================================================ */
async function getByReference(userId, reference) {
  const txn = await prisma.transaction.findUnique({
    where: { reference },
  });

  if (!txn || txn.userId !== userId) {
    throw new AppError('Transaction not found', 404, 'TRANSACTION_NOT_FOUND');
  }

  return publicTxn(txn);
}

/* ============================================================
   SUMMARY — totals for statements
   ============================================================ */
async function getSummary(userId, { from, to } = {}) {
  const where = { userId, status: 'COMPLETED' };
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(from);
    if (to) where.createdAt.lte = new Date(to);
  }

  const rows = await prisma.transaction.groupBy({
    by: ['type'],
    where,
    _sum: { amount: true },
    _count: true,
  });

  const summary = {};
  let totalIn = new Decimal(0);
  let totalOut = new Decimal(0);

  for (const row of rows) {
    const sum = new Decimal(row._sum.amount || 0);
    summary[row.type] = {
      total: sum.toString(),
      count: row._count,
    };
    if (sum.isPositive()) totalIn = totalIn.plus(sum);
    else totalOut = totalOut.plus(sum.abs());
  }

  return {
    from: from || null,
    to: to || null,
    totalIn: totalIn.toString(),
    totalOut: totalOut.toString(),
    net: totalIn.minus(totalOut).toString(),
    breakdown: summary,
  };
}

/* ============================================================
   PUBLIC SHAPE
   ============================================================ */
function publicTxn(txn) {
  return {
    id: txn.id,
    reference: txn.reference,
    type: txn.type,
    status: txn.status,
    amount: txn.amount.toString(),
    balanceBefore: txn.balanceBefore.toString(),
    balanceAfter: txn.balanceAfter.toString(),
    currency: txn.currency,
    description: txn.description,
    metadata: txn.metadata,
    betId: txn.betId,
    depositId: txn.depositId,
    withdrawalId: txn.withdrawalId,
    createdAt: txn.createdAt,
  };
}

module.exports = {
  listTransactions,
  getByReference,
  getSummary,
};