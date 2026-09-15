/**
 * ============================================================
 * CephasGM GameZone — Logger
 * ============================================================
 * Pino logger. Pretty console in dev, JSON in production.
 * ============================================================
 */

'use strict';

const pino = require('pino');
const config = require('./index');

const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.body.password',
  'req.body.newPassword',
  'req.body.oldPassword',
  'req.body.confirmPassword',
  'req.body.currentPassword',
  'req.body.otp',
  'req.body.pin',
  'req.body.cvv',
  'req.body.cardNumber',
  'password',
  'passwordHash',
  'refreshToken',
  'accessToken',
  'otp',
  'otpHash',
  'secret',
  'apiSecret',
  'privateKey',
];

const baseOptions = {
  level: config.isTest ? 'silent' : config.log.level,
  redact: { paths: REDACT_PATHS, censor: '[REDACTED]', remove: false },
  base: { app: config.appName, env: config.env },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
};

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
        singleLine: false,
      },
    },
  });
} else {
  logger = pino(baseOptions);
}

module.exports = logger;