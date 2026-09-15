/**
 * ============================================================
 * CephasGM GameZone — Withdrawal Service
 * ============================================================
 * Lifecycle:
 *   1. request()      — validate, lock funds, create PENDING row
 *   2. approve()      — admin marks approved, calls provider payout
 *   3. reject()       — admin rejects, unlocks funds
 *   4. confirmPayout()— provider reports success, consume locked funds
 *   5. handleWebhook()— callback from provider
 *
 * Security:
 *   • Requires KYC approved (checked in controller via requireKYC)
 *   • Funds are LOCKED the moment a withdrawal is requested
 *   • Admin can only approve once
 *   • Payout failure automatically unlocks funds
 * ============================================================
 */

'use strict';

const config = require('../config');
const logger = require('../config/logger');
const prisma = require('../config/database');
const { AppError } = require('../utils/AppError');
const { generateRef } = require('../utils/generateRef');
const payments = require('./payments');
const walletService = require('./wallet.service');
const Decimal = require('decimal.js');

/* ============================================================
   REQUEST
   ============================================================ */
async function request(userId, input) {
  const { amount, method, phone, accountName, bankName } = input;

  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    throw new AppError('Invalid withdrawal amount', 400, 'INVALID_AMOUNT');
  }
  if (amt < config.wallet.minWithdrawal) {
    throw new AppError(
      `Minimum withdrawal is ${config.wallet.minWithdrawal} ${config.wallet.defaultCurrency}`,
      400,
      'AMOUNT_BELOW_MIN'
    );
  }
  if (amt > config.wallet.maxWithdrawal) {
    throw new AppError(
      `Maximum withdrawal is ${config.wallet.maxWithdrawal} ${config.wallet.defaultCurrency}`,
      400,
      'AMOUNT_ABOVE_MAX'
    );
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError('User not found', 404, 'USER_NOT_FOUND');

  // Compute fee + net
  const feePercent = config.wallet.withdrawalFeePercent || 0;
  const fee = new Decimal(amt).mul(feePercent).div(100).toDecimalPlaces(2);
  const netAmount = new Decimal(amt).minus(fee);

  if (netAmount.lessThan(1)) {
    throw new AppError('Net amount after fee is too small', 400, 'AMOUNT_TOO_SMALL');
  }

  // Check balance (lock the funds immediately so they can't be spent)
  const methodUpper = String(method).toUpperCase();
  payments.get(methodUpper); // validates method + enabled

  const reference = generateRef('WTH');

  // Lock the full amount (fee is deducted from it at payout)
  await walletService.lockFunds(userId, amt, {
    reference: generateRef('TXN'),
    currency: user.currency,
  });

  // Create withdrawal row
  const withdrawal = await prisma.withdrawal.create({
    data: {
      userId,
      amount: amt,
      fee: fee.toNumber(),
      netAmount: netAmount.toNumber(),
      currency: user.currency || config.wallet.defaultCurrency,
      method: methodUpper,
      status: 'PENDING',
      reference,
      phoneNumber: phone || user.phone || null,
      accountNumber: phone || user.phone || null,
      accountName: accountName || user.fullName || null,
      bankName: bankName || null,
    },
  });

  logger.info(
    { userId, reference, amount: amt, method: methodUpper, fee: fee.toString() },
    '📤 Withdrawal requested — funds locked'
  );

  return publicWithdrawal(withdrawal);
}

/* ============================================================
   APPROVE (admin)
   ============================================================ */
async function approve(adminId, reference, note = null) {
  const withdrawal = await prisma.withdrawal.findUnique({ where: { reference } });
  if (!withdrawal) throw new AppError('Withdrawal not found', 404, 'NOT_FOUND');
  if (withdrawal.status !== 'PENDING') {
    throw new AppError(
      `Cannot approve — status is ${withdrawal.status}`,
      400,
      'INVALID_STATE'
    );
  }

  const provider = payments.defaultProviderFor(withdrawal.method);

  // Call the provider to send the money
  let payout;
  try {
    payout = await provider.initiatePayout({
      reference: withdrawal.reference,
      amount: Number(withdrawal.netAmount),
      currency: withdrawal.currency,
      phone: withdrawal.phoneNumber,
      accountName: withdrawal.accountName,
      metadata: { userId: withdrawal.userId, adminId },
    });
  } catch (err) {
    logger.error({ reference, err: err.message }, '❌ Payout threw');
    payout = { success: false, error: err.message };
  }

  if (!payout || !payout.success) {
    // Provider rejected — mark withdrawal as FAILED and unlock funds
    await walletService.unlockFunds(withdrawal.userId, Number(withdrawal.amount));

    const updated = await prisma.withdrawal.update({
      where: { id: withdrawal.id },
      data: {
        status: 'FAILED',
        reviewedBy: adminId,
        reviewedAt: new Date(),
        rejectionNote: payout?.error || 'Payout failed',
      },
    });

    logger.warn(
      { reference, err: payout?.error },
      '❌ Withdrawal failed at provider — funds unlocked'
    );

    return publicWithdrawal(updated);
  }

  // Success — mark as PROCESSING
  const updated = await prisma.withdrawal.update({
    where: { id: withdrawal.id },
    data: {
      status: 'PENDING',                // still pending until provider confirms
      externalRef: payout.providerRef || null,
      reviewedBy: adminId,
      reviewedAt: new Date(),
      processedAt: new Date(),
    },
  });

  logger.info(
    { reference, providerRef: payout.providerRef },
    '✅ Withdrawal approved — payout initiated'
  );

  return publicWithdrawal(updated);
}

/* ============================================================
   REJECT (admin)
   ============================================================ */
async function reject(adminId, reference, reason) {
  const withdrawal = await prisma.withdrawal.findUnique({ where: { reference } });
  if (!withdrawal) throw new AppError('Withdrawal not found', 404, 'NOT_FOUND');
  if (withdrawal.status !== 'PENDING') {
    throw new AppError(
      `Cannot reject — status is ${withdrawal.status}`,
      400,
      'INVALID_STATE'
    );
  }

  // Unlock the funds back to the user
  await walletService.unlockFunds(withdrawal.userId, Number(withdrawal.amount));

  const updated = await prisma.withdrawal.update({
    where: { id: withdrawal.id },
    data: {
      status: 'FAILED',
      reviewedBy: adminId,
      reviewedAt: new Date(),
      rejectionNote: reason || 'Rejected by admin',
    },
  });

  logger.info({ reference, adminId, reason }, '❌ Withdrawal rejected — funds unlocked');

  return publicWithdrawal(updated);
}

/* ============================================================
   CONFIRM PAYOUT — funds permanently leave the account
   ============================================================ */
async function confirmPayout(reference, providerRef = null, raw = null) {
  const withdrawal = await prisma.withdrawal.findUnique({ where: { reference } });
  if (!withdrawal) return { ok: false, reason: 'NOT_FOUND' };

  if (withdrawal.status === 'COMPLETED') {
    return { ok: true, reason: 'ALREADY_COMPLETED' };
  }

  // Consume the locked funds — the money actually leaves the wallet
  await walletService.consumeLocked(withdrawal.userId, Number(withdrawal.amount), {
    reference: generateRef('TXN'),
    description: `Withdrawal via ${withdrawal.method}`,
    currency: withdrawal.currency,
  });

  const updated = await prisma.withdrawal.update({
    where: { id: withdrawal.id },
    data: {
      status: 'COMPLETED',
      externalRef: providerRef || withdrawal.externalRef,
      completedAt: new Date(),
    },
  });

  logger.info(
    { reference, userId: withdrawal.userId, amount: withdrawal.amount.toString() },
    '✅ Withdrawal completed'
  );

  return { ok: true, withdrawal: publicWithdrawal(updated) };
}

/* ============================================================
   WEBHOOK
   ============================================================ */
async function handleWebhook(providerName, req) {
  const provider = payments[providerName];
  if (!provider || typeof provider.verifyWebhook !== 'function') {
    throw new AppError('Unknown provider', 400, 'UNKNOWN_PROVIDER');
  }

  const parsed = await provider.verifyWebhook(req);
  if (!parsed.valid) {
    throw new AppError('Invalid webhook signature', 401, 'INVALID_WEBHOOK');
  }

  const withdrawal = await prisma.withdrawal.findFirst({
    where: { externalRef: parsed.providerRef },
  });
  if (!withdrawal) return { ok: false, reason: 'NOT_FOUND' };

  if (parsed.status === 'SUCCESS') {
    return confirmPayout(withdrawal.reference, parsed.providerRef, parsed.raw);
  }

  if (parsed.status === 'FAILED') {
    await walletService.unlockFunds(withdrawal.userId, Number(withdrawal.amount));
    await prisma.withdrawal.update({
      where: { id: withdrawal.id },
      data: {
        status: 'FAILED',
        rejectionNote: 'Provider reported payout failure',
      },
    });
    return { ok: false, reason: 'FAILED' };
  }

  return { ok: true, reason: 'PENDING' };
}

/* ============================================================
   READ
   ============================================================ */
async function list(userId, { page = 1, limit = 20, status } = {}) {
  const skip = (page - 1) * limit;
  const where = { userId };
  if (status) where.status = status;

  const [items, total] = await Promise.all([
    prisma.withdrawal.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.withdrawal.count({ where }),
  ]);

  return {
    items: items.map(publicWithdrawal),
    pagination: { page, limit, total },
  };
}

async function getOne(userId, reference) {
  const withdrawal = await prisma.withdrawal.findUnique({ where: { reference } });
  if (!withdrawal || withdrawal.userId !== userId) {
    throw new AppError('Withdrawal not found', 404, 'NOT_FOUND');
  }
  return publicWithdrawal(withdrawal);
}

/* ============================================================
   PUBLIC SHAPE
   ============================================================ */
function publicWithdrawal(w) {
  return {
    id: w.id,
    reference: w.reference,
    amount: w.amount.toString(),
    fee: w.fee.toString(),
    netAmount: w.netAmount.toString(),
    currency: w.currency,
    method: w.method,
    status: w.status,
    phoneNumber: w.phoneNumber,
    accountName: w.accountName,
    bankName: w.bankName,
    externalRef: w.externalRef,
    rejectionNote: w.rejectionNote,
    processedAt: w.processedAt,
    completedAt: w.completedAt,
    createdAt: w.createdAt,
  };
}

module.exports = {
  request,
  approve,
  reject,
  confirmPayout,
  handleWebhook,
  list,
  getOne,
};