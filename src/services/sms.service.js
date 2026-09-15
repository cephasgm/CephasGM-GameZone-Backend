/**
 * ============================================================
 * CephasGM GameZone — SMS Service
 * ============================================================
 * Sends SMS via Africa's Talking (East Africa).
 * Falls back to logging in dev when not configured.
 * ============================================================
 */

'use strict';

const config = require('../config');
const logger = require('../config/logger');

let at = null;
let atSms = null;

if (config.sms.enabled && config.sms.provider === 'africastalking') {
  try {
    const africastalking = require('africastalking');

    at = africastalking({
      apiKey: config.sms.africastalking.apiKey,
      username: config.sms.africastalking.username,
    });

    atSms = at.SMS;
    logger.info('✅ Africa\'s Talking SMS client initialized');
  } catch (err) {
    logger.error({ err: err.message }, '❌ Failed to initialize Africa\'s Talking');
  }
}

/* ============================================================
   Base send
   ============================================================ */
async function send(to, message) {
  /* Dev fallback */
  if (!atSms) {
    logger.info(
      { to, message },
      `📱 [SMS-DEV] Would send: "${message}" to ${to}`
    );
    return { dev: true, to, message };
  }

  try {
    /* Ensure phone starts with + */
    const phone = String(to).startsWith('+') ? to : `+${to}`;

    const result = await atSms.send({
      to: [phone],
      message,
      from: config.sms.africastalking.senderId || undefined,
    });

    logger.info(
      { to: phone, message, result },
      '📱 SMS sent via Africa\'s Talking'
    );

    return { ok: true, result };
  } catch (err) {
    logger.error({ to, err: err.message }, '❌ SMS send failed');
    throw err;
  }
}

/* ============================================================
   OTP SMS
   ============================================================ */
async function sendOTP(to, otp, purpose = 'verification') {
  const messages = {
    verification: `Your CephasGM verification code is: ${otp}. Valid for 10 minutes. Never share this code.`,
    reset: `Your CephasGM password reset code is: ${otp}. Valid for 10 minutes. If you didn't request this, ignore this message.`,
    login: `Your CephasGM login code is: ${otp}. Valid for 10 minutes.`,
  };
  const message = messages[purpose] || `Your CephasGM code: ${otp}`;
  return send(to, message);
}

/* ============================================================
   Generic notification SMS
   ============================================================ */
async function sendNotification(to, text) {
  return send(to, text);
}

module.exports = {
  send,
  sendOTP,
  sendNotification,
  enabled: Boolean(atSms),
};