/**
 * ============================================================
 * CephasGM GameZone — Deposit Service
 * ============================================================
 * Orchestrates the full deposit lifecycle:
 *   1. initiate()      — create row, call provider, return instructions
 *   2. confirm()       — verify with provider, credit wallet, mark complete
 *   3. handleWebhook() — parse incoming provider callback
 *   4. checkStatus()   — poll provider for status (fallback)
 *   5. list / getOne   — read deposit history
 *
 * Idempotency:
 *   Every deposit has a unique `reference`. The `confirm()` step is
 *   idempotent — if a webhook arrives twice, or if a polling job and
 *   a webhook race, only the first confirm() credits the wallet.
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

/* ============================================================
   INITIATE
   ============================================================ */
async function initiate(userId, input) {
  const { amount, method, phone, email, accountNumber } = input;

  // Validate amount against config bounds
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0) {
    throw new AppError('Invalid deposit amount', 400, 'INVALID_AMOUNT');
  }
  if (amt < config.wallet.minDeposit) {
    throw new AppError(
      `Minimum deposit is ${config.wallet.minDeposit} ${config.wallet.defaultCurrency}`,
      400,
      'AMOUNT_BELOW_MIN'
    );
  }
  if (amt > config.wallet.maxDeposit) {
    throw new AppError(
      `Maximum deposit is ${config.wallet.maxDeposit} ${config.wallet.defaultCurrency}`,
      400,
      'AMOUNT_ABOVE_MAX'
    );
  }

  // Resolve user + provider
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError('User not found', 404, 'USER_NOT_FOUND');

  const provider = payments.get(method);

  // Create the deposit record in PENDING state
  const reference = generateRef('DEP');
  const deposit = await prisma.deposit.create({
    data: {
      userId,
      amount: amt,
      currency: user.currency || config.wallet.defaultCurrency,
      method,
      status: 'PENDING',
      reference,
      phoneNumber: phone || user.phone || null,
      accountNumber: accountNumber || null,
    },
  });

  // Call the provider
  let providerResult;
  try {
    providerResult = await provider.initiate({
      userId,
      reference,
      amount: amt,
      currency: deposit.currency,
      phone: phone || user.phone,
      email: email || user.email,
      metadata: {
        fullName: user.fullName,
        userId,
      },
    });
  } catch (err) {
    logger.error({ reference, err: err.message }, '❌ Provider initiate threw');
    providerResult = { success: false, error: err.message };
  }

  if (!providerResult || !providerResult.success) {
    // Mark the deposit as FAILED so we don't leave a dangling PENDING
    await prisma.deposit.update({
      where: { id: deposit.id },
      data: {
        status: 'FAILED',
        failureReason: providerResult?.error || 'Provider initiation failed',
        gatewayResponse: providerResult?.raw || null,
      },
    });

    throw new AppError(
      providerResult?.error || 'Could not initiate deposit',
      400,
      'DEPOSIT_INIT_FAILED'
    );
  }

  // Store provider ref + raw response
  const updated = await prisma.deposit.update({
    where: { id: deposit.id },
    data: {
      externalRef: providerResult.providerRef || null,
      gatewayResponse: providerResult.raw || null,
    },
  });

  logger.info(
    { userId, reference, amount: amt, method },
    '💵 Deposit initiated'
  );

  return {
    deposit: publicDeposit(updated),
    instructions: providerResult.instructions || null,
  };
}

/* ============================================================
   CONFIRM — internal, called by webhook handler AND polling job
   ------------------------------------------------------------
   Idempotent: if deposit is already COMPLETED, does nothing.
   ============================================================ */
async function confirm(reference, opts = {}) {
  const {
    status = 'SUCCESS',
    amount = null,
    providerRef = null,
    raw = null,
  } = opts;

  const deposit = await prisma.deposit.findUnique({ where: { reference } });
  if (!deposit) {
    logger.warn({ reference }, '⚠️  Deposit confirm: reference not found');
    return { ok: false, reason: 'NOT_FOUND' };
  }

  // Idempotency guard — already in a terminal state, skip
  if (deposit.status === 'COMPLETED') {
    return { ok: true, reason: 'ALREADY_COMPLETED', deposit: publicDeposit(deposit) };
  }
  if (deposit.status === 'FAILED' || deposit.status === 'CANCELLED') {
    return { ok: false, reason: 'TERMINAL_STATE', deposit: publicDeposit(deposit) };
  }

  // Handle failure
  if (status === 'FAILED') {
    const updated = await prisma.deposit.update({
      where: { id: deposit.id },
      data: {
        status: 'FAILED',
        failureReason: 'Provider reported failure',
        gatewayResponse: raw || undefined,
      },
    });
    logger.warn({ reference }, '❌ Deposit failed');
    return { ok: false, reason: 'FAILED', deposit: publicDeposit(updated) };
  }

  // Success path — verify amount matches (when provider sends it)
  const expected = Number(deposit.amount);
  const received = amount !== null ? Number(amount) : expected;
  if (Math.abs(received - expected) > 0.01) {
    logger.error(
      { reference, expected, received },
      '🚨 Amount mismatch — refusing to credit'
    );
    const updated = await prisma.deposit.update({
      where: { id: deposit.id },
      data: {
        status: 'FAILED',
        failureReason: `Amount mismatch: expected ${expected}, received ${received}`,
        gatewayResponse: raw || undefined,
      },
    });
    return { ok: false, reason: 'AMOUNT_MISMATCH', deposit: publicDeposit(updated) };
  }

  // Credit the wallet + mark deposit completed — inside a DB transaction
  const result = await prisma.$transaction(async (tx) => {
    // Re-fetch inside tx to lock in the current status (prevents race)
    const fresh = await tx.deposit.findUnique({ where: { id: deposit.id } });
    if (fresh.status === 'COMPLETED') {
      return { deposit: fresh, credited: false };
    }

    // Credit via wallet service
    const creditResult = await walletService.credit(
      deposit.userId,
      expected,
      {
        type: 'DEPOSIT',
        description: `Deposit via ${deposit.method}`,
        reference: generateRef('TXN'),
        depositId: deposit.id,
      }
    );

    const updated = await tx.deposit.update({
      where: { id: deposit.id },
      data: {
        status: 'COMPLETED',
        externalRef: providerRef || deposit.externalRef,
        gatewayResponse: raw || deposit.gatewayResponse,
        completedAt: new Date(),
      },
    });

    return { deposit: updated, credited: true, wallet: creditResult };
  });

  if (result.credited) {
    logger.info(
      { reference, userId: deposit.userId, amount: expected },
      '✅ Deposit completed — wallet credited'
    );
  } else {
    logger.info({ reference }, '↩️  Deposit already completed — skipped credit');
  }

  return {
    ok: true,
    reason: result.credited ? 'CREDITED' : 'ALREADY_COMPLETED',
    deposit: publicDeposit(result.deposit),
  };
}

/* ============================================================
   WEBHOOK HANDLER
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

  // Find the deposit — try by our reference first, fall back to providerRef
  let deposit = null;
  if (parsed.reference) {
    deposit = await prisma.deposit.findUnique({ where: { reference: parsed.reference } });
  }
  if (!deposit && parsed.providerRef) {
    deposit = await prisma.deposit.findFirst({
      where: { externalRef: parsed.providerRef },
    });
  }

  if (!deposit) {
    logger.warn(
      { provider: providerName, parsed },
      '⚠️  Webhook: deposit not found'
    );
    return { ok: false, reason: 'NOT_FOUND' };
  }

  return confirm(deposit.reference, {
    status: parsed.status,
    amount: parsed.amount,
    providerRef: parsed.providerRef,
    raw: parsed.raw,
  });
}

/* ============================================================
   POLL STATUS — ask provider directly
   ============================================================ */
async function checkStatus(userId, reference) {
  const deposit = await prisma.deposit.findUnique({ where: { reference } });
  if (!deposit || deposit.userId !== userId) {
    throw new AppError('Deposit not found', 404, 'DEPOSIT_NOT_FOUND');
  }
  if (deposit.status === 'COMPLETED' || deposit.status === 'FAILED') {
    return publicDeposit(deposit);
  }

  const provider = payments.defaultProviderFor(deposit.method);
  const status = await provider.checkStatus(deposit.reference, deposit.externalRef);

  if (status.status === 'SUCCESS') {
    await confirm(deposit.reference, {
      status: 'SUCCESS',
      amount: status.amount,
      raw: status.raw,
    });
    const fresh = await prisma.deposit.findUnique({ where: { reference } });
    return publicDeposit(fresh);
  }

  if (status.status === 'FAILED') {
    await confirm(deposit.reference, { status: 'FAILED', raw: status.raw });
    const fresh = await prisma.deposit.findUnique({ where: { reference } });
    return publicDeposit(fresh);
  }

  return publicDeposit(deposit);
}

/* ============================================================
   READ
   ============================================================ */
async function list(userId, { page = 1, limit = 20, status } = {}) {
  const skip = (page - 1) * limit;
  const where = { userId };
  if (status) where.status = status;

  const [items, total] = await Promise.all([
    prisma.deposit.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.deposit.count({ where }),
  ]);

  return {
    items: items.map(publicDeposit),
    pagination: { page, limit, total },
  };
}

async function getOne(userId, reference) {
  const deposit = await prisma.deposit.findUnique({ where: { reference } });
  if (!deposit || deposit.userId !== userId) {
    throw new AppError('Deposit not found', 404, 'DEPOSIT_NOT_FOUND');
  }
  return publicDeposit(deposit);
}

/* ============================================================
   DEV HELPER — simulate provider confirmation
   ------------------------------------------------------------
   Only available in development. Used for testing the mock
   provider without needing a real callback URL.
   ============================================================ */
async function simulateConfirm(userId, reference) {
  if (!config.isDev) {
    throw new AppError('Only available in development', 403, 'FORBIDDEN');
  }

  const deposit = await prisma.deposit.findUnique({ where: { reference } });
  if (!deposit || deposit.userId !== userId) {
    throw new AppError('Deposit not found', 404, 'DEPOSIT_NOT_FOUND');
  }
  if (deposit.status === 'COMPLETED') {
    return publicDeposit(deposit);
  }

  // Ask the provider what the current status is (mock returns SUCCESS after 5s)
  const provider = payments.defaultProviderFor(deposit.method);
  const status = await provider.checkStatus(deposit.reference, deposit.externalRef);

  if (status.status === 'SUCCESS') {
    await confirm(deposit.reference, {
      status: 'SUCCESS',
      amount: status.amount,
      raw: status.raw,
    });
  }

  const fresh = await prisma.deposit.findUnique({ where: { reference } });
  return publicDeposit(fresh);
}

/* ============================================================
   PUBLIC SHAPE
   ============================================================ */
function publicDeposit(d) {
  return {
    id: d.id,
    reference: d.reference,
    amount: d.amount.toString(),
    currency: d.currency,
    method: d.method,
    status: d.status,
    phoneNumber: d.phoneNumber,
    externalRef: d.externalRef,
    failureReason: d.failureReason,
    completedAt: d.completedAt,
    createdAt: d.createdAt,
  };
}

module.exports = {
  initiate,
  confirm,
  handleWebhook,
  checkStatus,
  list,
  getOne,
  simulateConfirm,
};