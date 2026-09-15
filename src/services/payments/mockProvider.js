/**
 * ============================================================
 * CephasGM GameZone — Mock Payment Provider
 * ============================================================
 * DEV ONLY. Simulates the full mobile money lifecycle without
 * touching real money or APIs.
 *
 * Behaviour:
 *   • initiate()          → returns PENDING immediately
 *   • checkStatus()       → SUCCESS after ~5s, FAILED if amount ends in .99
 *   • initiatePayout()    → returns PENDING, SUCCESS after ~30s
 *   • verifyWebhook()     → accepts any signed body (dev only)
 *
 * Disabled in production. If MOCK_PAYMENT_PROVIDER=true in .env,
 * it will still work — useful for staging.
 * ============================================================
 */

'use strict';

const crypto = require('crypto');

const config = require('../../config');
const logger = require('../../config/logger');
const PaymentProviderInterface = require('./provider.interface');

/* ------------------------------------------------------------
   In-memory store of mock transactions.
   Keyed by our reference. Value includes status + createdAt.
   ------------------------------------------------------------ */
const mockStore = new Map();

const SUCCESS_AFTER_MS = 5000;      // deposit completes after 5s
const FAIL_AFTER_MS    = 5000;      // but fails if amount ends in .99
const PAYOUT_AFTER_MS  = 30000;     // payout completes after 30s

class MockProvider extends PaymentProviderInterface {
  get name() {
    return 'mock';
  }

  isEnabled() {
    // Enabled in dev, or when explicitly turned on in env
    return config.isDev || process.env.MOCK_PAYMENT_PROVIDER === 'true';
  }

  /* ==========================================================
     DEPOSITS
     ========================================================== */

  async initiate({ userId, reference, amount, currency, phone, email }) {
    if (!this.isEnabled()) {
      return { success: false, error: 'Mock provider disabled' };
    }

    const providerRef = 'MOCK-DEP-' + crypto.randomBytes(6).toString('hex').toUpperCase();

    mockStore.set(reference, {
      type: 'deposit',
      userId,
      reference,
      providerRef,
      amount: Number(amount),
      currency,
      phone: phone || null,
      email: email || null,
      createdAt: Date.now(),
    });

    logger.info(
      { userId, reference, providerRef, amount, currency },
      '🧪 [MOCK] Deposit initiated'
    );

    return {
      success: true,
      providerRef,
      instructions: {
        method: 'mock',
        message:
          config.isDev
            ? 'Mock provider: deposit will auto-complete in ~5 seconds.'
            : 'Payment initiated. Please approve on your phone.',
        autoCompleteInMs: SUCCESS_AFTER_MS,
      },
      raw: { mock: true, reference, providerRef },
    };
  }

  async checkStatus(reference, _providerRef) {
    const record = mockStore.get(reference);
    if (!record) {
      return { status: 'FAILED', raw: { error: 'Unknown reference' } };
    }

    const elapsed = Date.now() - record.createdAt;

    // Failure rule: amount ends in .99
    const amountStr = String(record.amount);
    if (amountStr.endsWith('.99') && elapsed > FAIL_AFTER_MS) {
      return {
        status: 'FAILED',
        amount: record.amount,
        raw: { mock: true, reason: 'Simulated failure (.99 rule)' },
      };
    }

    if (elapsed >= SUCCESS_AFTER_MS) {
      return {
        status: 'SUCCESS',
        amount: record.amount,
        raw: { mock: true, paidAt: new Date().toISOString() },
      };
    }

    return {
      status: 'PENDING',
      amount: record.amount,
      raw: { mock: true, elapsed },
    };
  }

  async verifyWebhook(req) {
    // In dev, accept any body shaped like our callback.
    // Real providers verify HMAC signatures — M-Pesa/Flutterwave
    // have their own schemes (see those provider files).
    const body = req.body || {};

    if (!body.reference) {
      return { valid: false };
    }

    return {
      valid: true,
      event: body.event || 'payment.completed',
      providerRef: body.providerRef || null,
      reference: body.reference,
      status: (body.status || 'SUCCESS').toUpperCase(),
      amount: Number(body.amount || 0),
      raw: body,
    };
  }

  /* ==========================================================
     WITHDRAWALS
     ========================================================== */

  async initiatePayout({ reference, amount, currency, phone, accountName }) {
    if (!this.isEnabled()) {
      return { success: false, error: 'Mock provider disabled' };
    }

    const providerRef = 'MOCK-WTH-' + crypto.randomBytes(6).toString('hex').toUpperCase();

    mockStore.set(reference, {
      type: 'payout',
      reference,
      providerRef,
      amount: Number(amount),
      currency,
      phone,
      accountName,
      createdAt: Date.now(),
    });

    logger.info(
      { reference, providerRef, amount, currency, phone },
      '🧪 [MOCK] Withdrawal initiated'
    );

    return {
      success: true,
      providerRef,
      raw: { mock: true, reference, providerRef },
    };
  }

  async checkPayoutStatus(reference, _providerRef) {
    const record = mockStore.get(reference);
    if (!record) {
      return { status: 'FAILED', raw: { error: 'Unknown reference' } };
    }

    const elapsed = Date.now() - record.createdAt;

    if (elapsed >= PAYOUT_AFTER_MS) {
      return {
        status: 'SUCCESS',
        amount: record.amount,
        raw: { mock: true, paidAt: new Date().toISOString() },
      };
    }

    return {
      status: 'PENDING',
      amount: record.amount,
      raw: { mock: true, elapsed },
    };
  }

  /* ==========================================================
     DEV HELPER — simulate an instant callback
     ========================================================== */
  async simulateCallback(reference, status = 'SUCCESS') {
    const record = mockStore.get(reference);
    if (!record) return false;

    logger.info(
      { reference, status },
      '🧪 [MOCK] Simulating provider callback'
    );
    return true;
  }

  /* ==========================================================
     DEV HELPER — list all mock records
     ========================================================== */
  listAll() {
    return Array.from(mockStore.values());
  }
}

module.exports = new MockProvider();