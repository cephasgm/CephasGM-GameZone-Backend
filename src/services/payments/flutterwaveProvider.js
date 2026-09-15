/**
 * ============================================================
 * CephasGM GameZone — Flutterwave Provider
 * ============================================================
 * Covers cards, bank transfers, and mobile money across
 * Africa. Docs: https://developer.flutterwave.com
 *
 * Deposit flow:
 *   1. POST /v3/payments      → returns checkout link
 *   2. User pays via hosted page or inline JS widget
 *   3. Webhook with `verif-hash` header
 *   4. GET  /v3/transactions/:id/verify → confirmation
 *
 * Payout flow:
 *   POST /v3/transfers
 * ============================================================
 */

'use strict';

const axios = require('axios');
const crypto = require('crypto');

const config = require('../../config');
const logger = require('../../config/logger');
const PaymentProviderInterface = require('./provider.interface');

class FlutterwaveProvider extends PaymentProviderInterface {
  get name() {
    return 'flutterwave';
  }

  isEnabled() {
    const c = config.payments.flutterwave;
    return Boolean(c.enabled && c.secretKey);
  }

  /* ------------------------------------------------------------
     HTTP client with auth header
     ------------------------------------------------------------ */
  get client() {
    const c = config.payments.flutterwave;
    return axios.create({
      baseURL: c.baseUrl,
      timeout: 20000,
      headers: {
        Authorization: `Bearer ${c.secretKey}`,
        'Content-Type': 'application/json',
      },
    });
  }

  /* ==========================================================
     DEPOSIT — Hosted payment link
     ========================================================== */
  async initiate({ userId, reference, amount, currency, email, phone, metadata }) {
    if (!this.isEnabled()) {
      return { success: false, error: 'Flutterwave not configured' };
    }
    if (!email) {
      return { success: false, error: 'Email required for Flutterwave' };
    }

    const payload = {
      tx_ref: reference,
      amount: Number(amount),
      currency,
      redirect_url: `${config.appUrl}/payments/flutterwave/return`,
      payment_options: 'card,mobilemoney,banktransfer',
      customer: {
        email,
        phonenumber: phone || undefined,
        name: metadata?.fullName || undefined,
      },
      customizations: {
        title: 'CephasGM GameZone',
        description: `Wallet top-up ${reference}`,
        logo: `${config.frontendUrl}/icons/icon-192x192.png`,
      },
      meta: {
        userId,
        source: 'wallet-deposit',
        ...(metadata || {}),
      },
    };

    try {
      const res = await this.client.post('/payments', payload);

      logger.info({ reference, userId, amount }, '🌍 [FLW] Payment link created');

      return {
        success: true,
        providerRef: String(res.data?.data?.id || ''),
        instructions: {
          method: 'flutterwave',
          message: 'Complete payment via the checkout link.',
          checkoutUrl: res.data?.data?.link,
        },
        raw: res.data,
      };
    } catch (err) {
      const errData = err.response?.data || { message: err.message };
      logger.error({ reference, err: errData }, '❌ [FLW] Initiate failed');
      return {
        success: false,
        error: errData.message || 'Flutterwave request failed',
        raw: errData,
      };
    }
  }

  /* ==========================================================
     STATUS — Verify transaction
     ========================================================== */
  async checkStatus(_reference, providerRef) {
    if (!this.isEnabled() || !providerRef) return { status: 'PENDING' };

    try {
      const res = await this.client.get(
        `/transactions/${providerRef}/verify`
      );

      const d = res.data?.data || {};
      const statusMap = {
        successful: 'SUCCESS',
        failed:     'FAILED',
        cancelled:  'FAILED',
      };

      return {
        status: statusMap[d.status] || 'PENDING',
        amount: d.amount ? Number(d.amount) : null,
        raw: d,
      };
    } catch (err) {
      logger.warn({ providerRef, err: err.message }, '⚠️  [FLW] Verify failed');
      return { status: 'PENDING', raw: err.response?.data };
    }
  }

  /* ==========================================================
     WEBHOOK
     ----------------------------------------------------------
     Flutterwave sends a `verif-hash` header containing the
     secret hash you configured in the dashboard.
     ========================================================== */
  async verifyWebhook(req) {
    const c = config.payments.flutterwave;
    const receivedHash = req.headers['verif-hash'];

    if (!receivedHash || receivedHash !== c.webhookHash) {
      logger.warn('🚫 [FLW] Webhook hash mismatch');
      return { valid: false };
    }

    const body = req.body || {};
    const data = body.data || {};

    return {
      valid: true,
      event: body.event || 'payment.completed',
      providerRef: String(data.id || ''),
      reference: data.tx_ref || '',
      status:
        data.status === 'successful' ? 'SUCCESS' :
        data.status === 'failed'     ? 'FAILED' :
        'PENDING',
      amount: data.amount ? Number(data.amount) : null,
      receipt: data.flw_ref || null,
      raw: body,
    };
  }

  /* ==========================================================
     PAYOUT — Transfer to mobile money or bank
     ========================================================== */
  async initiatePayout({ reference, amount, currency, phone, accountName, metadata }) {
    if (!this.isEnabled()) {
      return { success: false, error: 'Flutterwave not configured' };
    }

    // Flutterwave payouts require a `type` — mobile money by default
    const payload = {
      account_bank: metadata?.bankCode || 'MPS',
      account_number: phone || metadata?.accountNumber,
      amount: Number(amount),
      currency,
      narration: `Withdrawal ${reference}`,
      reference,
      beneficiary_name: accountName || 'CephasGM User',
      meta: { userId: metadata?.userId },
    };

    try {
      const res = await this.client.post('/transfers', payload);

      logger.info({ reference, amount }, '📤 [FLW] Payout initiated');

      return {
        success: true,
        providerRef: String(res.data?.data?.id || ''),
        raw: res.data,
      };
    } catch (err) {
      const errData = err.response?.data || { message: err.message };
      logger.error({ reference, err: errData }, '❌ [FLW] Payout failed');
      return {
        success: false,
        error: errData.message || 'Flutterwave payout failed',
        raw: errData,
      };
    }
  }

  async checkPayoutStatus(_reference, providerRef) {
    if (!this.isEnabled() || !providerRef) return { status: 'PENDING' };

    try {
      const res = await this.client.get(`/transfers/${providerRef}`);
      const d = res.data?.data || {};

      const statusMap = {
        SUCCESSFUL: 'SUCCESS',
        FAILED:     'FAILED',
        PENDING:    'PENDING',
        NEW:        'PENDING',
      };

      return {
        status: statusMap[d.status] || 'PENDING',
        amount: d.amount ? Number(d.amount) : null,
        raw: d,
      };
    } catch (err) {
      return { status: 'PENDING', raw: err.response?.data };
    }
  }
}

module.exports = new FlutterwaveProvider();