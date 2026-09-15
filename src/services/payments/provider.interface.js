/**
 * ============================================================
 * CephasGM GameZone — Payment Provider Interface
 * ============================================================
 * Every payment provider (Mock, M-Pesa, Flutterwave, Tigo Pesa,
 * Airtel Money, etc.) MUST implement the methods below with the
 * exact same signatures and return shapes.
 *
 * The deposit/withdraw services never talk to a specific provider
 * — they get a provider from `payments/index.js` and call these
 * methods. Swapping providers = changing one config value.
 *
 * Return shape contract:
 *   initiate()         → { success, providerRef, instructions?, raw }
 *   checkStatus()      → { status: 'PENDING'|'SUCCESS'|'FAILED', raw }
 *   verifyWebhook()    → { valid, event, providerRef, status, amount, raw }
 *   initiatePayout()   → { success, providerRef, raw }
 *   checkPayoutStatus()→ { status: 'PENDING'|'SUCCESS'|'FAILED', raw }
 * ============================================================
 */

'use strict';

class PaymentProviderInterface {
  /**
   * Provider identifier — used for logging and provider selection.
   * @type {string}
   */
  get name() {
    throw new Error('Provider must implement a `name` getter');
  }

  /**
   * Whether this provider is fully configured (API keys present, etc.)
   * @returns {boolean}
   */
  isEnabled() {
    throw new Error('Provider must implement isEnabled()');
  }

  /* ==========================================================
     DEPOSITS — Customer → Platform
     ========================================================== */

  /**
   * Begin a deposit. Called when the user submits a deposit form.
   *
   * @param {object} params
   * @param {string} params.userId           — internal user id
   * @param {string} params.reference        — our unique ref (e.g. DEP-20260915-XYZ)
   * @param {number} params.amount           — in the account currency (e.g. TZS)
   * @param {string} params.currency         — ISO 4217 (e.g. 'TZS')
   * @param {string} [params.phone]          — customer phone (mobile money)
   * @param {string} [params.email]          — customer email (cards)
   * @param {object} [params.metadata]       — anything else we want to pass through
   *
   * @returns {Promise<{
   *   success:      boolean,
   *   providerRef?: string,
   *   instructions?: object,   // what to tell the user (e.g. "check your phone")
   *   raw?:         object,    // full provider response for audit
   *   error?:       string,
   * }>}
   */
  async initiate(_params) {
    throw new Error('Provider must implement initiate()');
  }

  /**
   * Poll the provider for the current status of a deposit.
   * Used as a fallback when webhooks aren't available or don't arrive.
   *
   * @param {string} reference — our unique ref
   * @param {string} [providerRef] — provider's ref if known
   * @returns {Promise<{
   *   status: 'PENDING'|'SUCCESS'|'FAILED',
   *   amount?: number,
   *   raw?:    object,
   * }>}
   */
  async checkStatus(_reference, _providerRef) {
    throw new Error('Provider must implement checkStatus()');
  }

  /**
   * Verify an incoming webhook request from the provider.
   * Called by the /deposits/webhook endpoint.
   *
   * @param {object} req — raw Express request (headers, body, rawBody)
   * @returns {Promise<{
   *   valid:       boolean,
   *   event:       string,
   *   providerRef: string,
   *   reference:   string,
   *   status:      'PENDING'|'SUCCESS'|'FAILED',
   *   amount:      number,
   *   raw:         object,
   * }>}
   */
  async verifyWebhook(_req) {
    throw new Error('Provider must implement verifyWebhook()');
  }

  /* ==========================================================
     WITHDRAWALS — Platform → Customer
     ========================================================== */

  /**
   * Send money to the customer. Called after admin approval.
   *
   * @param {object} params
   * @param {string} params.reference   — our unique ref (e.g. WTH-20260915-XYZ)
   * @param {number} params.amount      — amount to pay
   * @param {string} params.currency    — ISO 4217
   * @param {string} params.phone       — destination mobile number
   * @param {string} [params.accountName]
   * @param {object} [params.metadata]
   *
   * @returns {Promise<{
   *   success:      boolean,
   *   providerRef?: string,
   *   raw?:         object,
   *   error?:       string,
   * }>}
   */
  async initiatePayout(_params) {
    throw new Error('Provider must implement initiatePayout()');
  }

  /**
   * Poll payout status.
   */
  async checkPayoutStatus(_reference, _providerRef) {
    throw new Error('Provider must implement checkPayoutStatus()');
  }
}

module.exports = PaymentProviderInterface;