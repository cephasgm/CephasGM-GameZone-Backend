/**
 * ============================================================
 * CephasGM GameZone — Logger
 * ============================================================
 * Pino-based structured logger.
 *   • Development  → pretty console output (colourised)
 *   • Production   → single-line JSON (for log aggregators)
 *   • Test         → silent (keeps Jest output clean)
 *   • Optional     → dual output to console AND file
 *
 * Sensitive fields (passwords, tokens, OTPs) are automatically
 * redacted.
 *
 * Usage:
 *   const logger = require('./logger');
 *   logger.info('Server started');
 *   logger.info({ userId }, 'User logged in');
 *   logger.error({ err }, 'Payment failed');
 * ============================================================
 */

'use strict';

const fs = require('fs');
const path = require('path');
const pino = require('pino');

const config = require('./index');

/* ------------------------------------------------------------
   Ensure logs directory exists when logging to a file
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

  // Direct fields (in case we log a User model object)
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
   Base options shared between dev and prod
   ------------------------------------------------------------ */
const baseOptions = {
  level: config.isTest ? 'silent' : config.log.level,
  redact: {
    paths: REDACT_PATHS,
    censor: '[REDACTED]',
    remove: false,
  },
  base: {
    app: config.appName,
    env: config.env,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
};

/* ------------------------------------------------------------
   Build the logger
   ------------------------------------------------------------ */

let logger;

if (config.isTest) {
  // Silent in tests — no output
  logger = pino({ level: 'silent' });
}
else if (config.isDev && config.log.pretty && config.log.file) {
  // Dev with file logging → multi-target: pretty console + JSON file
  const targets = [
    {
      target: 'pino-pretty',
      level: config.log.level,
      options: {
        colorize: true,
        translateTime: 'SYS:HH:MM:ss.l',
        ignore: 'pid,hostname,app,env',
        messageFormat: '{msg}',
        singleLine: false,
      },
    },
    {
      target: 'pino/file',
      level: config.log.level,
      options: {
        destination: config.log.file,
        mkdir: true,
      },
    },
  ];

  logger = pino(baseOptions, pino.transport({ targets }));
}
else if (config.isDev && config.log.pretty) {
  // Dev, console only
  logger = pino({
    ...baseOptions,
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:HH:MM:ss.l',
        ignore: 'pid,hostname,app,env',
        messageFormat: '{msg}',
        singleLine: false,
      },
    },
  });
}
else if (config.log.file) {
  // Production with file logging — JSON to stdout AND file
  const targets = [
    {
      target: 'pino/file',
      level: config.log.level,
      options: { destination: 1 }, // 1 = stdout
    },
    {
      target: 'pino/file',
      level: config.log.level,
      options: {
        destination: config.log.file,
        mkdir: true,
      },
    },
  ];

  logger = pino(baseOptions, pino.transport({ targets }));
}
else {
  // Plain JSON logger (default production, or dev without pretty)
  logger = pino(baseOptions);
}

/* ------------------------------------------------------------
   Friendly startup note (dev only)
   ------------------------------------------------------------ */
if (config.isDev && !config.isTest) {
  logger.debug(
    `Logger initialised — level=${config.log.level} pretty=${config.log.pretty} file=${config.log.file || 'none'}`
  );
}

module.exports = logger;