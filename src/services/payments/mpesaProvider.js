/**
 * ============================================================
 * CephasGM GameZone — M-Pesa Provider (Vodacom Tanzania)
 * ============================================================
 * Implements the "Lipa na M-Pesa Online" (STK Push) flow.
 *
 * Sequence:
 *   1. OAuth: POST /oauth/v1/generate?grant_type=client_credentials
 *      → returns access_token (valid ~1 hour, cached)
 *   2. STK Push: POST /mpesa/stkpush/v1/processrequest
 *      → user receives a prompt on their phone
 *   3. Callback: M-Pesa POSTs the result to our webhook URL
 *   4. Query: POST /mpesa/stkpushquery/v1/query (fallback if no callback)
 *
 * Docs: https://developer.safaricom.co.ke (Kenya) — Vodacom TZ uses
 *       the same API shape with different base URL.
 * ============================================================
 */

'use strict';

const axios = require('axios');

const config = require('../../config');
const logger = require('../../config/logger');
const PaymentProviderInterface = require('./provider.interface');

/* ------------------------------------------------------------
   Base URLs
   ------------------------------------------------------------ */
const MPESA_HOSTS = {
  sandbox:    'https://sandbox.safaricom.co.ke',
  production: 'https://openapi.m-pesa.com',   // Vodacom TZ
};

/* ------------------------------------------------------------
   Token cache (in-memory)
   ------------------------------------------------------------ */
let cachedToken = null;
let cachedTokenExpiry = 0;

class MpesaProvider extends PaymentProviderInterface {
  get name() {
    return 'mpesa';
  }

  isEnabled() {
    const c = config.payments.mpesa;
    return Boolean(c.enabled && c.consumerKey && c.consumerSecret && c.shortcode);
  }

  /* ==========================================================
     AUTH — OAuth token with caching
     ========================================================== */
  async getAccessToken() {
    if (cachedToken && Date.now() < cachedTokenExpiry) {
      return cachedToken;
    }

    const c = config.payments.mpesa;
    const host = MPESA_HOSTS[c.environment] || MPESA_HOSTS.sandbox;

    const auth = Buffer.from(`${c.consumerKey}:${c.consumerSecret}`).toString('base64');

    const res = await axios.get(
      `${host}/oauth/v1/generate?grant_type=client_credentials`,
      { headers: { Authorization: `Basic ${auth}` }, timeout: 15000 }
    );

    cachedToken = res.data.access_token;
    cachedTokenExpiry = Date.now() + (Number(res.data.expires_in) - 60) * 1000;

    logger.debug('🔐 [MPESA] OAuth token refreshed');
    return cachedToken;
  }

  /* ==========================================================
     DEPOSIT — STK Push
     ========================================================== */
  async initiate({ userId, reference, amount, currency, phone }) {
    if (!this.isEnabled()) {
      return { success: false, error: 'M-Pesa not configured' };
    }
    if (!phone) {
      return { success: false, error: 'Phone number required for M-Pesa' };
    }

    const c = config.payments.mpesa;
    const host = MPESA_HOSTS[c.environment] || MPESA_HOSTS.sandbox;

    // Timestamp format: YYYYMMDDHHmmss
    const now = new Date();
    const timestamp =
      now.getFullYear() +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0') +
      String(now.getHours()).padStart(2, '0') +
      String(now.getMinutes()).padStart(2, '0') +
      String(now.getSeconds()).padStart(2, '0');

    // Password = base64(shortcode + passkey + timestamp)
    const password = Buffer.from(
      `${c.shortcode}${c.passkey}${timestamp}`
    ).toString('base64');

    // Format phone: 255XXXXXXXXX (no +, no leading 0)
    const normalizedPhone = this.normalizePhone(phone);

    const payload = {
      BusinessShortCode: c.shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: Math.round(Number(amount)),
      PartyA: normalizedPhone,
      PartyB: c.shortcode,
      PhoneNumber: normalizedPhone,
      CallBackURL: c.callbackUrl,
      AccountReference: reference,
      TransactionDesc: `Deposit ${reference}`,
    };

    try {
      const token = await this.getAccessToken();
      const res = await axios.post(
        `${host}/mpesa/stkpush/v1/processrequest`,
        payload,
        {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 20000,
        }
      );

      logger.info(
        { reference, userId, amount },
        '📱 [MPESA] STK Push sent'
      );

      return {
        success: true,
        providerRef: res.data.CheckoutRequestID,
        instructions: {
          method: 'mpesa',
          message: 'Check your phone for the M-Pesa prompt and enter your PIN.',
          checkoutRequestId: res.data.CheckoutRequestID,
          merchantRequestId: res.data.MerchantRequestID,
        },
        raw: res.data,
      };
    } catch (err) {
      const errData = err.response?.data || { message: err.message };
      logger.error(
        { reference, err: errData },
        '❌ [MPESA] STK Push failed'
      );
      return {
        success: false,
        error: errData.errorMessage || errData.message || 'M-Pesa request failed',
        raw: errData,
      };
    }
  }

  /* ==========================================================
     STATUS QUERY
     ========================================================== */
  async checkStatus(reference, providerRef) {
    if (!this.isEnabled()) return { status: 'PENDING' };

    const c = config.payments.mpesa;
    const host = MPESA_HOSTS[c.environment] || MPESA_HOSTS.sandbox;

    const now = new Date();
    const timestamp =
      now.getFullYear() +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0') +
      String(now.getHours()).padStart(2, '0') +
      String(now.getMinutes()).padStart(2, '0') +
      String(now.getSeconds()).padStart(2, '0');

    const password = Buffer.from(
      `${c.shortcode}${c.passkey}${timestamp}`
    ).toString('base64');

    try {
      const token = await this.getAccessToken();
      const res = await axios.post(
        `${host}/mpesa/stkpushquery/v1/query`,
        {
          BusinessShortCode: c.shortcode,
          Password: password,
          Timestamp: timestamp,
          CheckoutRequestID: providerRef,
        },
        { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 }
      );

      const resultCode = String(res.data.ResultCode);
      return {
        status:
          resultCode === '0' ? 'SUCCESS' :
          resultCode === '1032' ? 'PENDING' :
          resultCode === '1037' ? 'PENDING' :  // timeout waiting for PIN
          'FAILED',
        amount: null,
        raw: res.data,
      };
    } catch (err) {
      logger.warn({ reference, err: err.message }, '⚠️  [MPESA] Status query failed');
      return { status: 'PENDING', raw: err.response?.data };
    }
  }

  /* ==========================================================
     WEBHOOK VERIFICATION
     ----------------------------------------------------------
     M-Pesa doesn't sign callbacks. Security comes from:
       • Using an unguessable callback URL (add a secret path segment)
       • Verifying the CheckoutRequestID matches an active deposit
     ========================================================== */
  async verifyWebhook(req) {
    const body = req.body || {};
    const stk = body.Body?.stkCallback;

    if (!stk) {
      return { valid: false };
    }

    const resultCode = String(stk.ResultCode);

    // Extract amount from callback metadata if present
    const items = stk.CallbackMetadata?.Item || [];
    const amountItem = items.find((i) => i.Name === 'Amount');
    const receiptItem = items.find((i) => i.Name === 'MpesaReceiptNumber');

    return {
      valid: true,
      event: resultCode === '0' ? 'payment.completed' : 'payment.failed',
      providerRef: stk.CheckoutRequestID,
      reference: stk.MerchantRequestID,   // not our ref — resolved in service
      status: resultCode === '0' ? 'SUCCESS' : 'FAILED',
      amount: amountItem ? Number(amountItem.Value) : null,
      receipt: receiptItem ? receiptItem.Value : null,
      raw: stk,
    };
  }

  /* ==========================================================
     PAYOUT — B2C (Send money to customer)
     ========================================================== */
  async initiatePayout({ reference, amount, phone, accountName }) {
    if (!this.isEnabled()) {
      return { success: false, error: 'M-Pesa not configured' };
    }

    const c = config.payments.mpesa;
    const host = MPESA_HOSTS[c.environment] || MPESA_HOSTS.sandbox;

    const normalizedPhone = this.normalizePhone(phone);

    try {
      const token = await this.getAccessToken();

      const res = await axios.post(
        `${host}/mpesa/b2c/v1/paymentrequest`,
        {
          InitiatorName: 'cephasgm',   // configured in M-Pesa portal
          SecurityCredential: c.securityCredential || '',
          CommandID: 'BusinessPayment',
          Amount: Math.round(Number(amount)),
          PartyA: c.shortcode,
          PartyB: normalizedPhone,
          Remarks: `Withdrawal ${reference}`,
          QueueTimeOutURL: `${c.callbackUrl}/payout-timeout`,
          ResultURL: `${c.callbackUrl}/payout-result`,
          Occasion: accountName || 'Payout',
        },
        { headers: { Authorization: `Bearer ${token}` }, timeout: 20000 }
      );

      logger.info({ reference, amount, phone }, '📤 [MPESA] Payout initiated');

      return {
        success: true,
        providerRef: res.data.ConversationID,
        raw: res.data,
      };
    } catch (err) {
      const errData = err.response?.data || { message: err.message };
      logger.error({ reference, err: errData }, '❌ [MPESA] Payout failed');
      return {
        success: false,
        error: errData.errorMessage || errData.message || 'M-Pesa payout failed',
        raw: errData,
      };
    }
  }

  async checkPayoutStatus(_reference, _providerRef) {
    // B2C status comes via ResultURL callback, not polling
    return { status: 'PENDING' };
  }

  /* ==========================================================
     HELPERS
     ========================================================== */
  normalizePhone(phone) {
    // Strip spaces, dashes, plus sign
    let p = String(phone).replace(/[\s\-+]/g, '');

    // Local format: 07XXXXXXXX → 2557XXXXXXXX
    if (p.startsWith('0')) p = '255' + p.slice(1);

    // Already has 255 prefix — fine
    return p;
  }
}

module.exports = new MpesaProvider();