/**
 * ============================================================
 * CephasGM GameZone — User Service
 * ============================================================
 * Profile + settings management. Auth flows live in auth.service.
 * ============================================================
 */

'use strict';

const prisma = require('../config/database');
const { AppError } = require('../utils/AppError');

/* ------------------------------------------------------------
   PUBLIC SHAPE
   ------------------------------------------------------------ */
function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    phone: user.phone,
    username: user.username,
    fullName: user.fullName,
    avatarUrl: user.avatarUrl,
    dateOfBirth: user.dateOfBirth,
    country: user.country,
    city: user.city,
    address: user.address,
    language: user.language,
    currency: user.currency,
    role: user.role,
    status: user.status,
    emailVerified: user.emailVerified,
    phoneVerified: user.phoneVerified,
    kycStatus: user.kycStatus,
    vipTier: user.vipTier,
    vipPoints: user.vipPoints,
    totalWagered: user.totalWagered.toString(),
    totalDeposited: user.totalDeposited.toString(),
    totalWithdrawn: user.totalWithdrawn.toString(),
    totalWon: user.totalWon.toString(),
    referralCode: user.referralCode,
    twoFactorEnabled: user.twoFactorEnabled,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
  };
}

/* ------------------------------------------------------------
   GET PROFILE
   ------------------------------------------------------------ */
async function getProfile(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      wallets: {
        select: { id: true, currency: true, balance: true, isPrimary: true },
      },
    },
  });
  if (!user) throw new AppError('User not found', 404, 'USER_NOT_FOUND');

  return {
    ...publicUser(user),
    wallets: user.wallets,
  };
}

/* ------------------------------------------------------------
   UPDATE PROFILE
   ------------------------------------------------------------ */
async function updateProfile(userId, input) {
  // Uniqueness checks
  if (input.username) {
    const taken = await prisma.user.findFirst({
      where: { username: input.username, NOT: { id: userId } },
    });
    if (taken) throw new AppError('Username is already taken', 409, 'USERNAME_TAKEN');
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      fullName: input.fullName,
      username: input.username,
      dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : undefined,
      country: input.country,
      city: input.city,
      address: input.address,
      language: input.language,
      avatarUrl: input.avatarUrl,
    },
  });

  return publicUser(updated);
}

/* ------------------------------------------------------------
   UPDATE SETTINGS
   ------------------------------------------------------------ */
async function updateSettings(userId, input) {
  // Note: we don't yet have marketingEmails / marketingSms columns
  // on the User model. Ignore them for now, or add later.
  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      currency: input.currency,
      language: input.language,
      twoFactorEnabled: input.twoFactorEnabled,
    },
  });

  return publicUser(updated);
}

/* ------------------------------------------------------------
   DEACTIVATE ACCOUNT — soft delete
   ------------------------------------------------------------ */
async function deactivateAccount(userId, reason = null) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError('User not found', 404, 'USER_NOT_FOUND');

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: {
        status: 'CLOSED',
        deletedAt: new Date(),
      },
    }),
    // Revoke all active sessions
    prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);

  return { deactivated: true };
}

module.exports = {
  getProfile,
  updateProfile,
  updateSettings,
  deactivateAccount,
  publicUser,
};