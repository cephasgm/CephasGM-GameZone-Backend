/**
 * ============================================================
 * CephasGM GameZone — Game Validators
 * ============================================================
 */

'use strict';

const { z } = require('zod');

const gameTypeEnum = z.enum([
  'VIRTUAL_FOOTBALL',
  'VIRTUAL_HORSE_RACING',
  'VIRTUAL_CAR_RACING',
  'VIRTUAL_NETBALL',
  'AVIATOR',
]);

const gameTypeParamSchema = z.object({
  gameType: gameTypeEnum,
});

const roundIdParamSchema = z.object({
  roundId: z.string().min(1).max(64),
});

const historyQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(50).default(20),
});

module.exports = {
  gameTypeParamSchema,
  roundIdParamSchema,
  historyQuerySchema,
};