/**
 * ============================================================
 * CephasGM GameZone — Socket.io Bootstrap (stub)
 * ============================================================
 * Minimal socket server for now. Full implementation
 * (live odds, bet slip sync, notifications) comes in Wave 9.
 * ============================================================
 */

'use strict';

const { Server } = require('socket.io');
const logger = require('../config/logger');
const config = require('../config');

function initSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: config.isDev ? true : config.corsOrigins,
      credentials: true,
    },
    pingTimeout: 30000,
    pingInterval: 25000,
  });

  io.on('connection', (socket) => {
    logger.debug({ socketId: socket.id }, '🔌 Socket connected');

    socket.on('disconnect', (reason) => {
      logger.debug({ socketId: socket.id, reason }, '🔌 Socket disconnected');
    });
  });

  logger.info('✅ Socket.io attached');
  return io;
}

module.exports = { initSocket };