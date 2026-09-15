/**
 * ============================================================
 * CephasGM GameZone — Logger
 * ============================================================
 * Pino-based structured logger.
 *   • Development  → pretty-printed, colourised console output
 *   • Production   → single-line JSON (for log aggregators)
 *   • Test         → silent (to keep Jest output clean)
 *   • Sensitive fields auto-redacted (passwords, tokens, OTPs)
 *
 * Usage:
 *   const logger = require('./logger');
 *   logger.info('Server started');
 *   logger.info({ userId }, 'User logged in');
 *   logger.error({ err }, 'Payment failed');
 * ============================================================
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const pino = require('pino');

const config = require('./index');

/* ------------------------------------------------------------
   Ensure the logs directory exists (only when logging to file)
   ------------------------------------------------------------ */
if (config.log.file) {
  const logDir = path.dirname(config.log.file);
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
}

/* ------------------------------------------------------------
   Redaction — never leak secrets into logs
   ------------------------------------------------------------ */
const REDACT_PATHS = [
  // Request-level
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["x-auth-token"]',

  // Body fields
  'req.body.password',
  'req.body.newPassword',
  'req.body.oldPassword',
  'req.body.confirmPassword',
  'req.body.currentPassword',
  'req.body.otp',
  'req.body.pin',
  'req.body.cvv',
  'req.body.cardNumber',
  'req.body.apiKey',
  'req.body.secret',

  // Response-level
  'res.headers["set-cookie"]',

  // Nested objects (in case we log a User model directly)
  'password',
  'passwordHash',
  'refreshToken',
  'accessToken',
  'otp',
  'otpHash',
  'secret',
  'apiSecret',
  'privateKey',

  // Payment payloads
  '*.cardNumber',
  '*.cvv',
  '*.pin',
];

/* ------------------------------------------------------------
   Build the logger
   ------------------------------------------------------------ */

// Base options shared between dev and prod
const baseOptions = {
  level: config.isTest ? 'silent' : config.log.level,
  redact: {
    paths: REDACT_PATHS,
    censor: '[REDACTED]',
    remove: false,
  },
  base: {
    // Attach static metadata to every log line
    app: config.appName,
    env: config.env,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level(label) {
      // "info" instead of 30
      return { level: label };
    },
  },
};

// Development → pretty console output
let logger;
if (config.isDev && config.log.pretty) {
  logger = pino({
    ...baseOptions,
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:HH:MM:ss.l',
        ignore: 'pid,hostname,app,env',
        messageFormat: '{msg}',
        levelFirst: false,
        singleLine: false,
      },
    },
  });
} else {
  logger = pino(baseOptions);
}

/* ------------------------------------------------------------
   Optional: also write raw JSON logs to a file
   ------------------------------------------------------------ */
if (config.log.file && !config.isTest) {
  const fileStream = pino.destination({
    dest: config.log.file,
    sync: false,
    mkdir: true,
  });

  // Dual-write: pretty console + JSON file
  const fileLogger = pino(baseOptions, fileStream);
  const original    = logger;

  // Wrap the main logger methods to also write to file
  ['fatal', 'error', 'warn', 'info', 'debug', 'trace'].forEach((level) => {
    logger[level] = (obj, msg) => {
      original[level](obj, msg);
      fileLogger[level](obj, msg);
    };
  });
}

/* ------------------------------------------------------------
   Friendly startup banner (dev only)
   ------------------------------------------------------------ */
if (config.isDev) {
  logger.debug(
    `Logger initialised — level=${config.log.level} ` +
    `pretty=${config.log.pretty} file=${config.log.file || 'none'}`
  );
}

module.exports = logger;