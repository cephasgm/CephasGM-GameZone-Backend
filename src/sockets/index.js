/**
 * ============================================================
 * CephasGM GameZone — Socket.io Server
 * ============================================================
 * Real-time channels:
 *   • Auth handshake via JWT (query: ?token=...)
 *   • Per-user room:        user:<userId>
 *   • Per-game room:        game:<gameType>
 *
 * Events emitted to clients:
 *   • notification         — new in-app notification
 *   • game:round-start     — new round began (betting open)
 *   • game:round-update    — phase changed (in progress, settled)
 *   • bet:settled          — user's bet won/lost/cashout
 *   • wallet:updated       — wallet balance changed
 * ============================================================
 */

'use strict';

const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

const config = require('../config');
const logger = require('../config/logger');

function initSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: config.isDev ? true : config.corsOrigins,
      credentials: true,
    },
    pingTimeout: 30000,
    pingInterval: 25000,
  });

  /* ----------------------------------------------------------
     Auth middleware — decode JWT from handshake
     ---------------------------------------------------------- */
  io.use((socket, next) => {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.query?.token ||
      null;

    if (!token) {
      // Allow anonymous — they can still subscribe to public game rooms
      socket.data.userId = null;
      return next();
    }

    try {
      const payload = jwt.verify(token, config.jwt.accessSecret);
      if (payload.type !== 'access') throw new Error('Wrong token type');

      socket.data.userId = payload.sub;
      socket.data.role = payload.role;
      next();
    } catch (err) {
      // Don't reject — just log and treat as anonymous
      logger.debug({ err: err.message }, 'Socket auth failed — anonymous');
      socket.data.userId = null;
      next();
    }
  });

  /* ----------------------------------------------------------
     Connection handler
     ---------------------------------------------------------- */
  io.on('connection', (socket) => {
    const { userId } = socket.data;

    logger.debug(
      { socketId: socket.id, userId: userId || 'anonymous' },
      '🔌 Socket connected'
    );

    /* Join the user's personal room for private events */
    if (userId) {
      socket.join(`user:${userId}`);
    }

    /* Client wants to subscribe to a game's live updates */
    socket.on('subscribe:game', (gameType) => {
      const allowed = [
        'AVIATOR',
        'VIRTUAL_FOOTBALL',
        'VIRTUAL_HORSE_RACING',
        'VIRTUAL_CAR_RACING',
        'VIRTUAL_NETBALL',
      ];
      if (!allowed.includes(gameType)) return;

      socket.join(`game:${gameType}`);
      logger.debug(
        { socketId: socket.id, gameType },
        `📡 Subscribed to game:${gameType}`
      );
    });

    socket.on('unsubscribe:game', (gameType) => {
      socket.leave(`game:${gameType}`);
    });

    /* Ping/pong for latency measurement */
    socket.on('ping:check', (callback) => {
      if (typeof callback === 'function') callback({ ok: true, t: Date.now() });
    });

    socket.on('disconnect', (reason) => {
      logger.debug(
        { socketId: socket.id, userId: userId || 'anonymous', reason },
        '🔌 Socket disconnected'
      );
    });
  });

  /* Expose globally so services can emit without importing io */
  global.__io = io;

  logger.info('✅ Socket.io attached (real-time channels active)');
  return io;
}

/* ============================================================
   EMIT HELPERS — called by services/round manager
   ============================================================ */

function emitToUser(userId, event, data) {
  if (!global.__io) return;
  global.__io.to(`user:${userId}`).emit(event, data);
}

function emitToGame(gameType, event, data) {
  if (!global.__io) return;
  global.__io.to(`game:${gameType}`).emit(event, data);
}

function broadcast(event, data) {
  if (!global.__io) return;
  global.__io.emit(event, data);
}

module.exports = {
  initSocket,
  emitToUser,
  emitToGame,
  broadcast,
};