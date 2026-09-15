/**
 * ============================================================
 * CephasGM GameZone — Support Controller
 * ============================================================
 */

'use strict';

const supportService = require('../services/support.service');
const apiResponse = require('../utils/apiResponse');
const asyncHandler = require('../utils/asyncHandler');
const { AppError } = require('../utils/AppError');

/* USER */
const create = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');
  const ticket = await supportService.createTicket(req.user.id, req.body);
  return apiResponse.created(res, ticket, 'Ticket created');
});

const listMine = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');
  const result = await supportService.listMyTickets(req.user.id, req.query);
  return apiResponse.paginated(res, result.items, result.pagination);
});

const getOne = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');
  const ticket = await supportService.getTicket(req.user.id, req.params.id);
  return apiResponse.ok(res, ticket);
});

const reply = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');
  const ticket = await supportService.reply(req.user.id, req.params.id, req.body, false);
  return apiResponse.ok(res, ticket, 'Reply sent');
});

const close = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');
  await supportService.closeTicket(req.user.id, req.params.id);
  return apiResponse.ok(res, null, 'Ticket closed');
});

/* ADMIN */
const adminList = asyncHandler(async (req, res) => {
  const result = await supportService.adminListTickets(req.query);
  return apiResponse.paginated(res, result.items, result.pagination);
});

const adminGet = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');
  const ticket = await supportService.getTicket(req.user.id, req.params.id, true);
  return apiResponse.ok(res, ticket);
});

const adminReply = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');
  const ticket = await supportService.reply(req.user.id, req.params.id, req.body, true);
  return apiResponse.ok(res, ticket, 'Reply sent');
});

const adminUpdate = asyncHandler(async (req, res) => {
  if (!req.user) throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');
  const result = await supportService.adminUpdateTicket(req.user.id, req.params.id, req.body);
  return apiResponse.ok(res, result, 'Ticket updated');
});

module.exports = {
  create, listMine, getOne, reply, close,
  adminList, adminGet, adminReply, adminUpdate,
};