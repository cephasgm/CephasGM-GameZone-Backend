/**
 * ============================================================
 * CephasGM GameZone — Prisma Client
 * ============================================================
 * Singleton Prisma client with:
 *   • Connection pooling (safe for serverless + long-running)
 *   • Query logging in development only
 *   • Slow-query warnings
 *   • Graceful shutdown helper
 *
 * Usage:
 *   const prisma = require('./config/database');
 *   const users = await prisma.user.findMany();
 * ============================================================
 */

'use strict';

const { PrismaClient } = require('@prisma/client');

const config = require('./index');
const logger = require('./logger');

/* ------------------------------------------------------------
   Logging configuration
   ------------------------------------------------------------ */

// Events to log
const logConfig = [];

if (config.isDev) {
  // In dev, log every query + warning + error
  logConfig.push(
    { emit: 'event', level: 'query' },
    { emit: 'event', level: 'warn' },
    { emit: 'event', level: 'error' }
  );
} else {
  // In production, only warn + error (never log queries — could leak data)
  logConfig.push(
    { emit: 'event', level: 'warn' },
    { emit: 'event', level: 'error' }
  );
}

/* ------------------------------------------------------------
   Instantiate
   ------------------------------------------------------------ */
const prisma = new PrismaClient({
  datasources: {
    db: { url: config.databaseUrl },
  },
  log: logConfig,
  errorFormat: config.isProd ? 'minimal' : 'pretty',
});

/* ------------------------------------------------------------
   Wire up log events
   ------------------------------------------------------------ */

if (config.isDev) {
  prisma.$on('query', (e) => {
    const duration = e.duration;

    // Slow query warning (>500ms)
    if (duration > 500) {
      logger.warn(
        { duration, query: e.query, params: e.params },
        `🐢 Slow query (${duration}ms)`
      );
    } else {
      logger.debug(
        { duration, query: e.query },
        `🔍 Prisma query (${duration}ms)`
      );
    }
  });
}

prisma.$on('warn', (e) => {
  logger.warn({ target: e.target }, `⚠️  Prisma warning: ${e.message}`);
});

prisma.$on('error', (e) => {
  logger.error({ target: e.target }, `❌ Prisma error: ${e.message}`);
});

/* ------------------------------------------------------------
   Global safety net — never crash the process
   ------------------------------------------------------------ */
process.on('beforeExit', async () => {
  // Node is about to exit — give Prisma a chance to clean up
  await prisma.$disconnect();
});

/* ------------------------------------------------------------
   Test helpers — used only in NODE_ENV=test
   ------------------------------------------------------------ */
if (config.isTest) {
  // Expose a truncate helper for tests
  prisma.$truncateAll = async () => {
    const tables = await prisma.$queryRaw`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename NOT LIKE '_prisma%'
    `;

    for (const { tablename } of tables) {
      await prisma.$executeRawUnsafe(
        `TRUNCATE TABLE "${tablename}" RESTART IDENTITY CASCADE;`
      );
    }
  };
}

module.exports = prisma;