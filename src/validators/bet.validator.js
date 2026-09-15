/**
 * ============================================================
 * CephasGM GameZone — Bet Validators
 * ============================================================
 */

'use strict';

const { z } = require('zod');

const selectionSchema = z.object({
  eventId: z.string().min(1).max(100),
  eventName: z.string().min(1).max(200).optional(),
  market: z.string().max(50).default('1X2'),
  selection: z.string().min(1).max(100),
  odds: z.coerce.number().min(1.01).max(10000),
  eventStartAt: z.string().datetime({ offset: true }).optional(),
});

const betTypeEnum = z.enum(['SINGLE', 'MULTIPLE', 'SYSTEM', 'VIRTUAL', 'CASINO']);

const gameTypeEnum = z
  .enum([
    'VIRTUAL_FOOTBALL',
    'VIRTUAL_HORSE_RACING',
    'VIRTUAL_CAR_RACING',
    'VIRTUAL_NETBALL',
    'AVIATOR',
    'CASINO_SLOTS',
    'CASINO_ROULETTE',
    'CASINO_BLACKJACK',
    'LIVE_CASINO',
  ])
  .optional();

/* POST /bets — place a bet */
const placeBetSchema = z.object({
  type: betTypeEnum.default('SINGLE'),
  stake: z.coerce.number().positive(),
  currency: z.string().length(3).toUpperCase().optional(),
  selections: z.array(selectionSchema).min(1).max(20),
  gameType: gameTypeEnum,
  roundId: z.string().max(100).optional(),
  metadata: z.record(z.any()).optional(),
});

/* GET /bets — filters */
const listBetsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z
    .enum(['PENDING', 'WON', 'LOST', 'CASHED_OUT', 'VOID', 'CANCELLED'])
    .optional(),
  type: betTypeEnum.optional(),
});

/* Path param */
const referenceParamSchema = z.object({
  reference: z.string().min(4).max(64),
});

module.exports = {
  placeBetSchema,
  listBetsSchema,
  referenceParamSchema,
};