/**
 * ============================================================
 * CephasGM GameZone — Express Application
 * ============================================================
 * Middleware pipeline (order matters!):
 *   1. Security headers (helmet)
 *   2. CORS
 *   3. Body parsers (JSON, urlencoded)
 *   4. Cookie parser
 *   5. HTTP parameter pollution guard (hpp)
 *   6. Compression
 *   7. Request logging (pino-http)
 *   8. Rate limiting
 *   9. Routes (/health, /api/v1/*)
 *  10. 404 handler
 *  11. Central error handler
 * ============================================================
 */

'use strict';

const express       = require('express');
const helmet        = require('helmet');
const cors          = require('cors');
const compression   = require('compression');
const cookieParser  = require('cookie-parser');
const hpp           = require('hpp');
const pinoHttp      = require('pino-http');

const config        = require('./config');
const logger        = require('./config/logger');
const routes        = require('./routes');
const { apiLimiter } = require('./middleware/rateLimiter');
const notFound       = require('./middleware/notFound');
const errorHandler   = require('./middleware/errorHandler');

const app = express();

/* ------------------------------------------------------------
   Trust proxy (behind Render / Railway / Nginx / Cloudflare)
   Without this, rate limiting would see every request as
   coming from the same IP.
   ------------------------------------------------------------ */
app.set('trust proxy', 1);

/* ------------------------------------------------------------
   1. Security headers
   ------------------------------------------------------------ */
app.use(
  helmet({
    contentSecurityPolicy: config.env === 'production' ? undefined : false,
    crossOriginEmbedderPolicy: false, // allows loading remote images (Cloudinary)
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

/* ------------------------------------------------------------
   2. CORS
   ------------------------------------------------------------ */
app.use(
  cors({
    origin(origin, callback) {
      // Allow requests with no origin (mobile apps, curl, same-origin)
      if (!origin) return callback(null, true);

      // In development, allow everything
      if (config.env === 'development') return callback(null, true);

      // In production, enforce whitelist
      if (config.corsOrigins.includes(origin)) return callback(null, true);

      logger.warn({ origin }, '🚫 CORS blocked');
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    exposedHeaders: ['X-Total-Count', 'X-Request-Id'],
    maxAge: 86400, // 24h preflight cache
  })
);

/* ------------------------------------------------------------
   3. Body parsers — keep limits tight to prevent abuse
   ------------------------------------------------------------ */
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

/* ------------------------------------------------------------
   4. Cookie parser (for refresh token if stored as httpOnly cookie)
   ------------------------------------------------------------ */
app.use(cookieParser(config.cookieSecret));

/* ------------------------------------------------------------
   5. HTTP Parameter Pollution guard
   ------------------------------------------------------------ */
app.use(hpp());

/* ------------------------------------------------------------
   6. Response compression (gzip)
   ------------------------------------------------------------ */
app.use(compression());

/* ------------------------------------------------------------
   7. Request logging
   ------------------------------------------------------------ */
app.use(
  pinoHttp({
    logger,
    // Don't log health checks to reduce noise
    autoLogging: {
      ignore: (req) => req.url === '/health',
    },
    customLogLevel(req, res, err) {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    customSuccessMessage(req, res) {
      return `${req.method} ${req.url} → ${res.statusCode}`;
    },
    customErrorMessage(req, res) {
      return `${req.method} ${req.url} → ${res.statusCode} (error)`;
    },
    // Redact secrets from logs
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.body.password',
        'req.body.confirmPassword',
        'req.body.otp',
        'req.body.pin',
      ],
      censor: '[REDACTED]',
    },
  })
);

/* ------------------------------------------------------------
   8. Rate limiting (global)
   ------------------------------------------------------------ */
app.use(config.apiPrefix, apiLimiter);

/* ------------------------------------------------------------
   9. Health check (before the API prefix so it's cacheable / cheap)
   ------------------------------------------------------------ */
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    env: config.env,
    version: require('../package.json').version,
  });
});

// Root — friendly pointer
app.get('/', (req, res) => {
  res.json({
    name: config.appName,
    message: 'API is live. See /health for status.',
    api: config.apiPrefix,
    docs: 'https://cephasgm.github.io/CephasGM-GameZone',
  });
});

/* ------------------------------------------------------------
   10. API routes
   ------------------------------------------------------------ */
app.use(config.apiPrefix, routes);

/* ------------------------------------------------------------
   11. 404 for anything unmatched
   ------------------------------------------------------------ */
app.use(notFound);

/* ------------------------------------------------------------
   12. Central error handler (must be last)
   ------------------------------------------------------------ */
app.use(errorHandler);

module.exports = app;