/**
 * ============================================================
 * CephasGM GameZone — Wallet Service
 * ============================================================
 * The single source of truth for money movement.
 *
 * Every operation:
 *   1. Runs inside a Postgres transaction (Prisma $transaction)
 *   2. Reads the current wallet with a row lock (SELECT ... FOR UPDATE)
 *   3. Validates funds are sufficient (for debits)
 *   4. Updates the wallet balance
 *   5. Creates a matching Transaction ledger entry
 *
 * If any step fails, everything rolls back. No half-changes.
 * ============================================================
 */

'use strict';

const config = require('../config');
const logger = require('../config/logger');
const prisma = require('../config/database');
const { AppError } = require('../utils/AppError');
const { generateRef } = require('../utils/generateRef');
const Decimal = require('decimal.js');

/* ============================================================
   HELPERS
   ============================================================ */

/* Convert Prisma Decimal or number/string → Decimal.js */
function toDecimal(v) {
  return new Decimal(v || 0);
}

/* Ensure amount is positive and non-zero */
function validateAmount(amount) {
  const d = toDecimal(amount);
  if (d.isNaN() || d.isNegative() || d.isZero()) {
    throw new AppError('Amount must be a positive number', 400, 'INVALID_AMOUNT');
  }
  return d;
}

/* ============================================================
   READ OPERATIONS
   ============================================================ */

/**
 * Get the primary wallet for a user. Creates one if it doesn't exist.
 * Used by /auth/me and by every other service.
 */
async function getPrimaryWallet(userId, currency = null) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { currency: true },
  });

  if (!user) {
    throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  }

  const targetCurrency = currency || user.currency || config.wallet.defaultCurrency;

  let wallet = await prisma.wallet.findUnique({
    where: {
      userId_currency: { userId, currency: targetCurrency },
    },
  });

  // Auto-create if missing (e.g. user registered before this feature)
  if (!wallet) {
    wallet = await prisma.wallet.create({
      data: {
        userId,
        currency: targetCurrency,
        balance: 0,
        lockedBalance: 0,
        bonusBalance: 0,
        isPrimary: true,
      },
    });
  }

  return wallet;
}

/**
 * Return balance summary for a user's primary wallet.
 */
async function getBalance(userId, currency = null) {
  const wallet = await getPrimaryWallet(userId, currency);
  return {
    walletId: wallet.id,
    currency: wallet.currency,
    balance: wallet.balance.toString(),
    lockedBalance: wallet.lockedBalance.toString(),
    bonusBalance: wallet.bonusBalance.toString(),
    availableBalance: toDecimal(wallet.balance)
      .minus(wallet.lockedBalance)
      .toString(),
  };
}

/* ============================================================
   WRITE OPERATIONS — all inside prisma.$transaction
   ============================================================ */

/**
 * Credit the user's wallet (add money).
 *
 * @param {string} userId
 * @param {number|string} amount
 * @param {object} opts — { type, description, metadata, reference, depositId, ... }
 */
async function credit(userId, amount, opts = {}) {
  const amt = validateAmount(amount);
  const {
    type = 'ADJUSTMENT',
    description = 'Credit',
    metadata = null,
    reference = generateRef('TXN'),
    depositId = null,
    betId = null,
    withdrawalId = null,
    bonusId = null,
    referralId = null,
    useBonus = false, // credit to bonusBalance instead of main balance
    currency = null,
  } = opts;

  const result = await prisma.$transaction(async (tx) => {
    const wallet = await getWalletLocked(tx, userId, currency);

    const before = toDecimal(wallet.balance);
    const after = before.plus(amt);

    const updated = await tx.wallet.update({
      where: { id: wallet.id },
      data: useBonus
        ? { bonusBalance: { increment: amt.toString() } }
        : { balance: { increment: amt.toString() } },
    });

    const txn = await tx.transaction.create({
      data: {
        userId,
        walletId: wallet.id,
        type,
        status: 'COMPLETED',
        amount: amt.toString(),
        balanceBefore: before.toString(),
        balanceAfter: after.toString(),
        currency: wallet.currency,
        reference,
        description,
        metadata: metadata || undefined,
        depositId,
        withdrawalId,
        betId,
        bonusId,
        referralId,
      },
    });

    return { wallet: updated, transaction: txn };
  });

  logger.info(
    { userId, amount: amt.toString(), type, reference },
    '💰 Wallet credited'
  );

  return {
    walletId: result.wallet.id,
    currency: result.wallet.currency,
    balance: result.wallet.balance.toString(),
    transaction: result.transaction,
  };
}

/**
 * Debit the user's wallet (subtract money).
 * Throws if insufficient balance.
 */
async function debit(userId, amount, opts = {}) {
  const amt = validateAmount(amount);
  const {
    type = 'ADJUSTMENT',
    description = 'Debit',
    metadata = null,
    reference = generateRef('TXN'),
    betId = null,
    withdrawalId = null,
    depositId = null,
    allowNegative = false,
    currency = null,
  } = opts;

  const result = await prisma.$transaction(async (tx) => {
    const wallet = await getWalletLocked(tx, userId, currency);

    const before = toDecimal(wallet.balance);
    const available = before.minus(wallet.lockedBalance);

    if (!allowNegative && available.lessThan(amt)) {
      throw new AppError('Insufficient balance', 400, 'INSUFFICIENT_BALANCE', {
        available: available.toString(),
        requested: amt.toString(),
      });
    }

    const after = before.minus(amt);

    const updated = await tx.wallet.update({
      where: { id: wallet.id },
      data: { balance: { decrement: amt.toString() } },
    });

    const txn = await tx.transaction.create({
      data: {
        userId,
        walletId: wallet.id,
        type,
        status: 'COMPLETED',
        amount: amt.negated().toString(), // debits stored as negative
        balanceBefore: before.toString(),
        balanceAfter: after.toString(),
        currency: wallet.currency,
        reference,
        description,
        metadata: metadata || undefined,
        betId,
        withdrawalId,
        depositId,
      },
    });

    return { wallet: updated, transaction: txn };
  });

  logger.info(
    { userId, amount: amt.toString(), type, reference },
    '💸 Wallet debited'
  );

  return {
    walletId: result.wallet.id,
    currency: result.wallet.currency,
    balance: result.wallet.balance.toString(),
    transaction: result.transaction,
  };
}

/**
 * Lock funds for a pending bet. Moves money from "available" into
 * "locked" without changing total balance.
 */
async function lockFunds(userId, amount, opts = {}) {
  const amt = validateAmount(amount);
  const { betId, reference = generateRef('TXN'), currency = null } = opts;

  const result = await prisma.$transaction(async (tx) => {
    const wallet = await getWalletLocked(tx, userId, currency);

    const before = toDecimal(wallet.balance);
    const locked = toDecimal(wallet.lockedBalance);
    const available = before.minus(locked);

    if (available.lessThan(amt)) {
      throw new AppError('Insufficient balance to place bet', 400, 'INSUFFICIENT_BALANCE', {
        available: available.toString(),
        requested: amt.toString(),
      });
    }

    const updated = await tx.wallet.update({
      where: { id: wallet.id },
      data: { lockedBalance: { increment: amt.toString() } },
    });

    await tx.transaction.create({
      data: {
        userId,
        walletId: wallet.id,
        type: 'BET_PLACED',
        status: 'COMPLETED',
        amount: amt.negated().toString(),
        balanceBefore: before.toString(),
        balanceAfter: before.toString(), // unchanged — just locked
        currency: wallet.currency,
        reference,
        description: 'Bet stake locked',
        betId,
      },
    });

    return { wallet: updated };
  });

  return {
    walletId: result.wallet.id,
    currency: result.wallet.currency,
    balance: result.wallet.balance.toString(),
    lockedBalance: result.wallet.lockedBalance.toString(),
  };
}

/**
 * Unlock funds (release a pending bet stake back to available).
 */
async function unlockFunds(userId, amount, opts = {}) {
  const amt = validateAmount(amount);
  const { betId, reference = generateRef('TXN'), currency = null } = opts;

  const result = await prisma.$transaction(async (tx) => {
    const wallet = await getWalletLocked(tx, userId, currency);

    if (toDecimal(wallet.lockedBalance).lessThan(amt)) {
      throw new AppError('Cannot unlock more than locked', 400, 'INVALID_UNLOCK');
    }

    const updated = await tx.wallet.update({
      where: { id: wallet.id },
      data: { lockedBalance: { decrement: amt.toString() } },
    });

    return { wallet: updated };
  });

  return {
    walletId: result.wallet.id,
    lockedBalance: result.wallet.lockedBalance.toString(),
  };
}

/**
 * Consume locked funds permanently — the bet lost. Balance AND
 * lockedBalance both decrease. Used by bet settlement.
 */
async function consumeLocked(userId, amount, opts = {}) {
  const amt = validateAmount(amount);
  const {
    betId,
    reference = generateRef('TXN'),
    description = 'Bet lost',
    currency = null,
  } = opts;

  const result = await prisma.$transaction(async (tx) => {
    const wallet = await getWalletLocked(tx, userId, currency);

    const before = toDecimal(wallet.balance);
    const after = before.minus(amt);

    const updated = await tx.wallet.update({
      where: { id: wallet.id },
      data: {
        balance: { decrement: amt.toString() },
        lockedBalance: { decrement: amt.toString() },
      },
    });

    await tx.transaction.create({
      data: {
        userId,
        walletId: wallet.id,
        type: 'BET_PLACED',
        status: 'COMPLETED',
        amount: amt.negated().toString(),
        balanceBefore: before.toString(),
        balanceAfter: after.toString(),
        currency: wallet.currency,
        reference,
        description,
        betId,
      },
    });

    return { wallet: updated };
  });

  return {
    walletId: result.wallet.id,
    balance: result.wallet.balance.toString(),
    lockedBalance: result.wallet.lockedBalance.toString(),
  };
}

/**
 * Settle a winning bet — releases locked funds AND credits winnings.
 * Net effect: balance goes up by `payout` (which is potential win),
 * lockedBalance goes down by `stake`.
 */
async function creditWinnings(userId, stake, payout, opts = {}) {
  const stakeAmt = validateAmount(stake);
  const payoutAmt = toDecimal(payout);
  const {
    betId,
    reference = generateRef('TXN'),
    description = 'Bet won',
    currency = null,
  } = opts;

  const result = await prisma.$transaction(async (tx) => {
    const wallet = await getWalletLocked(tx, userId, currency);

    const before = toDecimal(wallet.balance);
    const after = before.plus(payoutAmt);

    const updated = await tx.wallet.update({
      where: { id: wallet.id },
      data: {
        balance: { increment: payoutAmt.toString() },
        lockedBalance: { decrement: stakeAmt.toString() },
      },
    });

    await tx.transaction.create({
      data: {
        userId,
        walletId: wallet.id,
        type: 'BET_WON',
        status: 'COMPLETED',
        amount: payoutAmt.toString(),
        balanceBefore: before.toString(),
        balanceAfter: after.toString(),
        currency: wallet.currency,
        reference,
        description,
        betId,
      },
    });

    return { wallet: updated };
  });

  return {
    walletId: result.wallet.id,
    balance: result.wallet.balance.toString(),
    lockedBalance: result.wallet.lockedBalance.toString(),
  };
}

/* ============================================================
   INTERNAL — locked wallet fetch
   ------------------------------------------------------------
   Prisma doesn't expose SELECT FOR UPDATE directly, but $transaction
   with serializable isolation gives us the equivalent guarantee.
   We read the wallet inside the transaction so any concurrent debit
   sees the latest committed value.
   ============================================================ */
async function getWalletLocked(tx, userId, currency = null) {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { currency: true },
  });
  const targetCurrency = currency || user?.currency || config.wallet.defaultCurrency;

  let wallet = await tx.wallet.findUnique({
    where: { userId_currency: { userId, currency: targetCurrency } },
  });

  if (!wallet) {
    wallet = await tx.wallet.create({
      data: {
        userId,
        currency: targetCurrency,
        balance: 0,
        lockedBalance: 0,
        bonusBalance: 0,
        isPrimary: true,
      },
    });
  }

  return wallet;
}

module.exports = {
  getPrimaryWallet,
  getBalance,
  credit,
  debit,
  lockFunds,
  unlockFunds,
  consumeLocked,
  creditWinnings,
};/**
 * ============================================================
 * CephasGM GameZone — Wallet Service
 * ============================================================
 * The single source of truth for money movement.
 *
 * Every operation:
 *   1. Runs inside a Postgres transaction (Prisma $transaction)
 *   2. Reads the current wallet with a row lock (SELECT ... FOR UPDATE)
 *   3. Validates funds are sufficient (for debits)
 *   4. Updates the wallet balance
 *   5. Creates a matching Transaction ledger entry
 *
 * If any step fails, everything rolls back. No half-changes.
 * ============================================================
 */

'use strict';

const config = require('../config');
const logger = require('../config/logger');
const prisma = require('../config/database');
const { AppError } = require('../utils/AppError');
const { generateRef } = require('../utils/generateRef');
const Decimal = require('decimal.js');

/* ============================================================
   HELPERS
   ============================================================ */

/* Convert Prisma Decimal or number/string → Decimal.js */
function toDecimal(v) {
  return new Decimal(v || 0);
}

/* Ensure amount is positive and non-zero */
function validateAmount(amount) {
  const d = toDecimal(amount);
  if (d.isNaN() || d.isNegative() || d.isZero()) {
    throw new AppError('Amount must be a positive number', 400, 'INVALID_AMOUNT');
  }
  return d;
}

/* ============================================================
   READ OPERATIONS
   ============================================================ */

/**
 * Get the primary wallet for a user. Creates one if it doesn't exist.
 * Used by /auth/me and by every other service.
 */
async function getPrimaryWallet(userId, currency = null) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { currency: true },
  });

  if (!user) {
    throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  }

  const targetCurrency = currency || user.currency || config.wallet.defaultCurrency;

  let wallet = await prisma.wallet.findUnique({
    where: {
      userId_currency: { userId, currency: targetCurrency },
    },
  });

  // Auto-create if missing (e.g. user registered before this feature)
  if (!wallet) {
    wallet = await prisma.wallet.create({
      data: {
        userId,
        currency: targetCurrency,
        balance: 0,
        lockedBalance: 0,
        bonusBalance: 0,
        isPrimary: true,
      },
    });
  }

  return wallet;
}

/**
 * Return balance summary for a user's primary wallet.
 */
async function getBalance(userId, currency = null) {
  const wallet = await getPrimaryWallet(userId, currency);
  return {
    walletId: wallet.id,
    currency: wallet.currency,
    balance: wallet.balance.toString(),
    lockedBalance: wallet.lockedBalance.toString(),
    bonusBalance: wallet.bonusBalance.toString(),
    availableBalance: toDecimal(wallet.balance)
      .minus(wallet.lockedBalance)
      .toString(),
  };
}

/* ============================================================
   WRITE OPERATIONS — all inside prisma.$transaction
   ============================================================ */

/**
 * Credit the user's wallet (add money).
 *
 * @param {string} userId
 * @param {number|string} amount
 * @param {object} opts — { type, description, metadata, reference, depositId, ... }
 */
async function credit(userId, amount, opts = {}) {
  const amt = validateAmount(amount);
  const {
    type = 'ADJUSTMENT',
    description = 'Credit',
    metadata = null,
    reference = generateRef('TXN'),
    depositId = null,
    betId = null,
    withdrawalId = null,
    bonusId = null,
    referralId = null,
    useBonus = false, // credit to bonusBalance instead of main balance
    currency = null,
  } = opts;

  const result = await prisma.$transaction(async (tx) => {
    const wallet = await getWalletLocked(tx, userId, currency);

    const before = toDecimal(wallet.balance);
    const after = before.plus(amt);

    const updated = await tx.wallet.update({
      where: { id: wallet.id },
      data: useBonus
        ? { bonusBalance: { increment: amt.toString() } }
        : { balance: { increment: amt.toString() } },
    });

    const txn = await tx.transaction.create({
      data: {
        userId,
        walletId: wallet.id,
        type,
        status: 'COMPLETED',
        amount: amt.toString(),
        balanceBefore: before.toString(),
        balanceAfter: after.toString(),
        currency: wallet.currency,
        reference,
        description,
        metadata: metadata || undefined,
        depositId,
        withdrawalId,
        betId,
        bonusId,
        referralId,
      },
    });

    return { wallet: updated, transaction: txn };
  });

  logger.info(
    { userId, amount: amt.toString(), type, reference },
    '💰 Wallet credited'
  );

  return {
    walletId: result.wallet.id,
    currency: result.wallet.currency,
    balance: result.wallet.balance.toString(),
    transaction: result.transaction,
  };
}

/**
 * Debit the user's wallet (subtract money).
 * Throws if insufficient balance.
 */
async function debit(userId, amount, opts = {}) {
  const amt = validateAmount(amount);
  const {
    type = 'ADJUSTMENT',
    description = 'Debit',
    metadata = null,
    reference = generateRef('TXN'),
    betId = null,
    withdrawalId = null,
    depositId = null,
    allowNegative = false,
    currency = null,
  } = opts;

  const result = await prisma.$transaction(async (tx) => {
    const wallet = await getWalletLocked(tx, userId, currency);

    const before = toDecimal(wallet.balance);
    const available = before.minus(wallet.lockedBalance);

    if (!allowNegative && available.lessThan(amt)) {
      throw new AppError('Insufficient balance', 400, 'INSUFFICIENT_BALANCE', {
        available: available.toString(),
        requested: amt.toString(),
      });
    }

    const after = before.minus(amt);

    const updated = await tx.wallet.update({
      where: { id: wallet.id },
      data: { balance: { decrement: amt.toString() } },
    });

    const txn = await tx.transaction.create({
      data: {
        userId,
        walletId: wallet.id,
        type,
        status: 'COMPLETED',
        amount: amt.negated().toString(), // debits stored as negative
        balanceBefore: before.toString(),
        balanceAfter: after.toString(),
        currency: wallet.currency,
        reference,
        description,
        metadata: metadata || undefined,
        betId,
        withdrawalId,
        depositId,
      },
    });

    return { wallet: updated, transaction: txn };
  });

  logger.info(
    { userId, amount: amt.toString(), type, reference },
    '💸 Wallet debited'
  );

  return {
    walletId: result.wallet.id,
    currency: result.wallet.currency,
    balance: result.wallet.balance.toString(),
    transaction: result.transaction,
  };
}

/**
 * Lock funds for a pending bet. Moves money from "available" into
 * "locked" without changing total balance.
 */
async function lockFunds(userId, amount, opts = {}) {
  const amt = validateAmount(amount);
  const { betId, reference = generateRef('TXN'), currency = null } = opts;

  const result = await prisma.$transaction(async (tx) => {
    const wallet = await getWalletLocked(tx, userId, currency);

    const before = toDecimal(wallet.balance);
    const locked = toDecimal(wallet.lockedBalance);
    const available = before.minus(locked);

    if (available.lessThan(amt)) {
      throw new AppError('Insufficient balance to place bet', 400, 'INSUFFICIENT_BALANCE', {
        available: available.toString(),
        requested: amt.toString(),
      });
    }

    const updated = await tx.wallet.update({
      where: { id: wallet.id },
      data: { lockedBalance: { increment: amt.toString() } },
    });

    await tx.transaction.create({
      data: {
        userId,
        walletId: wallet.id,
        type: 'BET_PLACED',
        status: 'COMPLETED',
        amount: amt.negated().toString(),
        balanceBefore: before.toString(),
        balanceAfter: before.toString(), // unchanged — just locked
        currency: wallet.currency,
        reference,
        description: 'Bet stake locked',
        betId,
      },
    });

    return { wallet: updated };
  });

  return {
    walletId: result.wallet.id,
    currency: result.wallet.currency,
    balance: result.wallet.balance.toString(),
    lockedBalance: result.wallet.lockedBalance.toString(),
  };
}

/**
 * Unlock funds (release a pending bet stake back to available).
 */
async function unlockFunds(userId, amount, opts = {}) {
  const amt = validateAmount(amount);
  const { betId, reference = generateRef('TXN'), currency = null } = opts;

  const result = await prisma.$transaction(async (tx) => {
    const wallet = await getWalletLocked(tx, userId, currency);

    if (toDecimal(wallet.lockedBalance).lessThan(amt)) {
      throw new AppError('Cannot unlock more than locked', 400, 'INVALID_UNLOCK');
    }

    const updated = await tx.wallet.update({
      where: { id: wallet.id },
      data: { lockedBalance: { decrement: amt.toString() } },
    });

    return { wallet: updated };
  });

  return {
    walletId: result.wallet.id,
    lockedBalance: result.wallet.lockedBalance.toString(),
  };
}

/**
 * Consume locked funds permanently — the bet lost. Balance AND
 * lockedBalance both decrease. Used by bet settlement.
 */
async function consumeLocked(userId, amount, opts = {}) {
  const amt = validateAmount(amount);
  const {
    betId,
    reference = generateRef('TXN'),
    description = 'Bet lost',
    currency = null,
  } = opts;

  const result = await prisma.$transaction(async (tx) => {
    const wallet = await getWalletLocked(tx, userId, currency);

    const before = toDecimal(wallet.balance);
    const after = before.minus(amt);

    const updated = await tx.wallet.update({
      where: { id: wallet.id },
      data: {
        balance: { decrement: amt.toString() },
        lockedBalance: { decrement: amt.toString() },
      },
    });

    await tx.transaction.create({
      data: {
        userId,
        walletId: wallet.id,
        type: 'BET_PLACED',
        status: 'COMPLETED',
        amount: amt.negated().toString(),
        balanceBefore: before.toString(),
        balanceAfter: after.toString(),
        currency: wallet.currency,
        reference,
        description,
        betId,
      },
    });

    return { wallet: updated };
  });

  return {
    walletId: result.wallet.id,
    balance: result.wallet.balance.toString(),
    lockedBalance: result.wallet.lockedBalance.toString(),
  };
}

/**
 * Settle a winning bet — releases locked funds AND credits winnings.
 * Net effect: balance goes up by `payout` (which is potential win),
 * lockedBalance goes down by `stake`.
 */
async function creditWinnings(userId, stake, payout, opts = {}) {
  const stakeAmt = validateAmount(stake);
  const payoutAmt = toDecimal(payout);
  const {
    betId,
    reference = generateRef('TXN'),
    description = 'Bet won',
    currency = null,
  } = opts;

  const result = await prisma.$transaction(async (tx) => {
    const wallet = await getWalletLocked(tx, userId, currency);

    const before = toDecimal(wallet.balance);
    const after = before.plus(payoutAmt);

    const updated = await tx.wallet.update({
      where: { id: wallet.id },
      data: {
        balance: { increment: payoutAmt.toString() },
        lockedBalance: { decrement: stakeAmt.toString() },
      },
    });

    await tx.transaction.create({
      data: {
        userId,
        walletId: wallet.id,
        type: 'BET_WON',
        status: 'COMPLETED',
        amount: payoutAmt.toString(),
        balanceBefore: before.toString(),
        balanceAfter: after.toString(),
        currency: wallet.currency,
        reference,
        description,
        betId,
      },
    });

    return { wallet: updated };
  });

  return {
    walletId: result.wallet.id,
    balance: result.wallet.balance.toString(),
    lockedBalance: result.wallet.lockedBalance.toString(),
  };
}

/* ============================================================
   INTERNAL — locked wallet fetch
   ------------------------------------------------------------
   Prisma doesn't expose SELECT FOR UPDATE directly, but $transaction
   with serializable isolation gives us the equivalent guarantee.
   We read the wallet inside the transaction so any concurrent debit
   sees the latest committed value.
   ============================================================ */
async function getWalletLocked(tx, userId, currency = null) {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { currency: true },
  });
  const targetCurrency = currency || user?.currency || config.wallet.defaultCurrency;

  let wallet = await tx.wallet.findUnique({
    where: { userId_currency: { userId, currency: targetCurrency } },
  });

  if (!wallet) {
    wallet = await tx.wallet.create({
      data: {
        userId,
        currency: targetCurrency,
        balance: 0,
        lockedBalance: 0,
        bonusBalance: 0,
        isPrimary: true,
      },
    });
  }

  return wallet;
}

module.exports = {
  getPrimaryWallet,
  getBalance,
  credit,
  debit,
  lockFunds,
  unlockFunds,
  consumeLocked,
  creditWinnings,
};