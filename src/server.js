/**
 * ============================================================
 * CephasGM GameZone — Server Entry Point
 * ============================================================
 * Responsibilities:
 *   • Boot the HTTP server (Express)
 *   • Attach Socket.io for real-time channels
 *   • Start background jobs (bet settlement, virtual rounds)
 *   • Handle graceful shutdown (SIGTERM, SIGINT)
 *   • Global safety nets (unhandledRejection, uncaughtException)
 * ============================================================
 */

'use strict';

// Load environment variables FIRST — before any other import reads process.env
require('dotenv').config();

const http = require('http');

const app            = require('./app');
const config         = require('./config');
const logger         = require('./config/logger');
const prisma         = require('./config/database');
const { initSocket } = require('./sockets');
const { startJobs, stopJobs } = require('./jobs/scheduler');

/* ------------------------------------------------------------
   Create HTTP server (so Socket.io can share the same port)
   ------------------------------------------------------------ */
const server = http.createServer(app);

/* ------------------------------------------------------------
   Attach Socket.io
   ------------------------------------------------------------ */
const io = initSocket(server);
app.set('io', io); // so controllers can emit events via req.app.get('io')

/* ------------------------------------------------------------
   Graceful shutdown
   ------------------------------------------------------------ */
let isShuttingDown = false;

async function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info({ signal }, '🛑 Shutdown signal received — closing gracefully…');

  // Force-exit safety net if shutdown hangs
  const forceExitTimer = setTimeout(() => {
    logger.error('❌ Graceful shutdown timed out — forcing exit');
    process.exit(1);
  }, 15000);
  forceExitTimer.unref();

  try {
    // 1. Stop accepting new HTTP connections
    await new Promise((resolve) => server.close(resolve));
    logger.info('HTTP server closed');

    // 2. Stop background jobs
    stopJobs();
    logger.info('Background jobs stopped');

    // 3. Close Socket.io
    if (io && typeof io.close === 'function') {
      await new Promise((resolve) => io.close(resolve));
      logger.info('Socket.io closed');
    }

    // 4. Disconnect Prisma
    await prisma.$disconnect();
    logger.info('Prisma disconnected');

    logger.info('✅ Shutdown complete');
    process.exit(0);
  } catch (err) {
    logger.error({ err }, '❌ Error during shutdown');
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

/* ------------------------------------------------------------
   Global safety nets
   ------------------------------------------------------------ */

// Unhandled promise rejection — log it, don't crash silently
process.on('unhandledRejection', (reason, promise) => {
  logger.error(
    { reason, promise: promise?.toString?.() },
    '⚠️  Unhandled promise rejection'
  );
  // Don't exit — let the process continue but keep a paper trail
});

// Uncaught exception — log it, then exit (process is unsafe)
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, '💥 Uncaught exception — exiting');
  shutdown('uncaughtException');
});

/* ------------------------------------------------------------
   Boot sequence
   ------------------------------------------------------------ */
async function start() {
  try {
    // Verify DB connectivity before accepting traffic
    await prisma.$connect();
    logger.info('✅ Database connected');

    // Start background jobs (bet settlement, virtual rounds, etc.)
    startJobs();
    logger.info('✅ Background jobs started');

    // Start HTTP + WebSocket listener
    server.listen(config.port, () => {
      logger.info(
        {
          env:     config.env,
          port:    config.port,
          apiPath: `${config.apiPrefix}`,
          node:    process.version,
        },
        `🚀 CephasGM GameZone API listening on http://localhost:${config.port}`
      );

      if (config.env === 'development') {
        logger.info(`   Health:   http://localhost:${config.port}/health`);
        logger.info(`   API base: http://localhost:${config.port}${config.apiPrefix}`);
        logger.info(`   CORS:     ${config.corsOrigins.join(', ')}`);
      }
    });

    // Handle port-in-use errors cleanly
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        logger.fatal(`❌ Port ${config.port} is already in use`);
      } else {
        logger.fatal({ err }, '❌ Server error');
      }
      process.exit(1);
    });
  } catch (err) {
    logger.fatal({ err }, '❌ Failed to start server');
    process.exit(1);
  }
}

start();

module.exports = server;