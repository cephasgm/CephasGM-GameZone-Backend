/**
 * ============================================================
 * CephasGM GameZone — Email Service
 * ============================================================
 * Sends transactional emails via Resend.
 * Falls back to logging in dev when no API key is set.
 * ============================================================
 */

'use strict';

const config = require('../config');
const logger = require('../config/logger');

let resend = null;

if (config.mail.resendApiKey) {
  try {
    const { Resend } = require('resend');
    resend = new Resend(config.mail.resendApiKey);
    logger.info('✅ Resend email client initialized');
  } catch (err) {
    logger.error({ err: err.message }, '❌ Failed to initialize Resend');
  }
}

/* ============================================================
   Base send
   ============================================================ */
async function send({ to, subject, html, text = null }) {
  const from = `${config.mail.fromName} <${config.mail.fromAddress}>`;

  /* Dev fallback — no API key configured */
  if (!resend) {
    logger.info(
      { to, subject },
      `📧 [EMAIL-DEV] Would send: "${subject}" to ${to}`
    );
    return { dev: true, to, subject };
  }

  try {
    const result = await resend.emails.send({
      from,
      to,
      subject,
      html,
      text: text || html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
    });

    logger.info(
      { to, subject, id: result.data?.id },
      '📧 Email sent via Resend'
    );

    return { ok: true, id: result.data?.id };
  } catch (err) {
    logger.error(
      { to, subject, err: err.message },
      '❌ Email send failed'
    );
    throw err;
  }
}

/* ============================================================
   Brand template wrapper
   ============================================================ */
function wrapTemplate(title, bodyHtml) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#0a0a12;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#ffffff;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a12;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:rgba(0,0,0,0.6);border:1px solid rgba(255,255,255,0.06);border-radius:24px;padding:40px;">
          <tr>
            <td align="center" style="padding-bottom:32px;">
              <div style="font-size:24px;font-weight:800;">
                <span style="background:linear-gradient(135deg,#0055ff,#542bff);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">CephasGM</span>
                <span style="color:rgba(255,255,255,0.6);font-weight:300;">|</span>
                <span style="color:#ffffff;font-weight:700;">GameZone</span>
              </div>
            </td>
          </tr>
          ${bodyHtml}
          <tr>
            <td style="padding-top:32px;border-top:1px solid rgba(255,255,255,0.06);text-align:center;font-size:11px;color:rgba(255,255,255,0.25);">
              © 2026 CephasGM GameZone · 18+ · Play Responsibly
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/* ============================================================
   OTP email (verification / password reset)
   ============================================================ */
async function sendOTP(to, otp, purpose = 'verification') {
  const subjects = {
    verification: 'Verify your CephasGM account',
    reset: 'Reset your CephasGM password',
    login: 'Your CephasGM login code',
  };
  const subject = subjects[purpose] || 'Your CephasGM code';

  const bodyHtml = `
    <tr>
      <td>
        <h1 style="margin:0 0 12px;font-size:26px;font-weight:800;color:#ffffff;">Your verification code</h1>
        <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:rgba(255,255,255,0.55);">
          Use the code below to continue. It expires in 10 minutes.
        </p>
        <div style="background:rgba(0,85,255,0.08);border:1px solid rgba(0,85,255,0.28);border-radius:16px;padding:28px;text-align:center;margin-bottom:24px;">
          <div style="font-size:42px;font-weight:900;letter-spacing:0.3em;color:#6bffb0;font-family:'SF Mono',Monaco,monospace;">
            ${otp}
          </div>
        </div>
        <p style="margin:0;font-size:13px;line-height:1.6;color:rgba(255,255,255,0.4);">
          If you didn't request this, you can safely ignore this email.
        </p>
      </td>
    </tr>`;

  return send({ to, subject, html: wrapTemplate(subject, bodyHtml) });
}

/* ============================================================
   Welcome email
   ============================================================ */
async function sendWelcome(to, fullName) {
  const subject = 'Welcome to CephasGM GameZone!';
  const bodyHtml = `
    <tr>
      <td>
        <h1 style="margin:0 0 12px;font-size:26px;font-weight:800;color:#ffffff;">Welcome, ${fullName || 'Player'}! 🎉</h1>
        <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:rgba(255,255,255,0.55);">
          Your account is ready. Deposit, play, and win big.
        </p>
        <div style="text-align:center;margin-bottom:24px;">
          <a href="${config.frontendUrl}" style="display:inline-block;background:linear-gradient(135deg,#0055ff,#542bff);color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:50px;font-weight:700;font-size:14px;">
            Start Playing →
          </a>
        </div>
        <p style="margin:0;font-size:13px;line-height:1.6;color:rgba(255,255,255,0.4);">
          Need help? Reply to this email or visit our support center.
        </p>
      </td>
    </tr>`;

  return send({ to, subject, html: wrapTemplate(subject, bodyHtml) });
}

module.exports = {
  send,
  sendOTP,
  sendWelcome,
  enabled: Boolean(resend),
};