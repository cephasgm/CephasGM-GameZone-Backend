/**
 * ============================================================
 * CephasGM GameZone — Auth Service
 * ============================================================
 * Business logic for:
 *   • register           — create account + wallet + referral
 *   • login              — verify credentials, issue tokens
 *   • refresh            — rotate access token
 *   • logout             — revoke session
 *   • verifyEmail        — confirm OTP
 *   • forgotPassword     — issue reset OTP
 *   • resetPassword      — validate OTP, change password
 *   • changePassword     — authenticated password change
 *   • getMe              — return full current-user profile
 * ============================================================
 */

'use strict';

const crypto = require('crypto');

const config = require('../config');
const logger = require('../config/logger');
const prisma = require('../config/database');
const { AppError } = require('../utils/AppError');
const { hashPassword, comparePassword } = require('../utils/password');
const {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  getRefreshExpiryDate,
} = require('../utils/jwt');
const {
  generateOTP,
  hashOTP,
  compareOTP,
  getOTPExpiry,
  isOTPExpired,
} = require('../utils/otp');
const { generateRef } = require('../utils/generateRef');

/* ============================================================
   HELPERS
   ============================================================ */

/* Generate a unique referral code (retries on collision) */
async function generateUniqueReferralCode() {
  for (let i = 0; i < 5; i++) {
    const code = crypto.randomBytes(4).toString('hex').toUpperCase();
    const exists = await prisma.user.findUnique({ where: { referralCode: code } });
    if (!exists) return code;
  }
  throw new AppError('Could not generate unique referral code', 500, 'REFERRAL_GEN_FAILED');
}

/* Public user view — never leak passwordHash or sensitive fields */
function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    phone: user.phone,
    username: user.username,
    fullName: user.fullName,
    avatarUrl: user.avatarUrl,
    country: user.country,
    currency: user.currency,
    language: user.language,
    role: user.role,
    status: user.status,
    emailVerified: user.emailVerified,
    phoneVerified: user.phoneVerified,
    kycStatus: user.kycStatus,
    vipTier: user.vipTier,
    vipPoints: user.vipPoints,
    referralCode: user.referralCode,
    createdAt: user.createdAt,
  };
}

/* Store refresh token on Session row */
async function createSession(userId, refreshToken, req) {
  const expiresAt = getRefreshExpiryDate();

  const session = await prisma.session.create({
    data: {
      userId,
      refreshToken,
      expiresAt,
      ipAddress: req.ip || req.headers['x-forwarded-for'] || null,
      userAgent: req.headers['user-agent'] || null,
      deviceName: req.headers['x-device-name'] || null,
    },
  });

  return session;
}

/* Log OTP in dev (instead of sending email/SMS until those are wired) */
function deliverOTP(channel, destination, otp, purpose) {
  if (config.isDev) {
    logger.info(
      { channel, destination, otp, purpose },
      `📩 [DEV OTP] ${purpose} → ${channel}:${destination} — CODE: ${otp}`
    );
  }
  // TODO (Wave 5): wire real email.service / sms.service here
}

/* ============================================================
   REGISTER
   ============================================================ */
async function register(input, req) {
  const {
    fullName,
    email,
    phone,
    password,
    referralCode,
    country,
    currency,
  } = input;

  // Check for existing user
  if (email) {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new AppError('Email is already registered', 409, 'EMAIL_TAKEN');
    }
  }
  if (phone) {
    const existing = await prisma.user.findUnique({ where: { phone } });
    if (existing) {
      throw new AppError('Phone number is already registered', 409, 'PHONE_TAKEN');
    }
  }

  // Resolve referrer if code provided
  let referredById = null;
  if (referralCode) {
    const referrer = await prisma.user.findUnique({
      where: { referralCode: referralCode.toUpperCase() },
    });
    if (referrer) referredById = referrer.id;
  }

  const passwordHash = await hashPassword(password);
  const ownReferralCode = await generateUniqueReferralCode();

  // Create user + wallet + optional referral record in a transaction
  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: email || null,
        phone: phone || null,
        fullName,
        passwordHash,
        country,
        currency,
        role: 'USER',
        status: 'PENDING',
        referralCode: ownReferralCode,
        referredById,
      },
    });

    await tx.wallet.create({
      data: {
        userId: user.id,
        currency,
        balance: 0,
        isPrimary: true,
      },
    });

    if (referredById) {
      await tx.referral.create({
        data: {
          referrerId: referredById,
          referredId: user.id,
        },
      });
    }

    return user;
  });

  // Send email verification OTP
  const otp = generateOTP();
  const otpHash = await hashOTP(otp);

  // Store OTP transiently in-memory for now (later: dedicated table or Redis)
  otpStore.set(`verify:${result.id}`, {
    hash: otpHash,
    expiresAt: getOTPExpiry(),
  });

   if (result.email) {
    deliverOTP('email', result.email, otp, 'Email verification');
  } else if (result.phone) {
    deliverOTP('sms', result.phone, otp, 'Phone verification');
  }

  const user = publicUser(result);

  // In development, expose the OTP in the response so you can test
  // without digging through terminal logs.
  if (config.isDev) {
    user._devOtp = otp;
    user._devNote = 'OTP shown only because NODE_ENV=development';
  }

  return user;
}

/* ============================================================
   LOGIN
   ============================================================ */
async function login(input, req) {
  const { email, phone, password } = input;

  const user = await prisma.user.findFirst({
    where: email ? { email } : { phone },
  });

  if (!user || !user.passwordHash) {
    throw new AppError('Invalid credentials', 401, 'INVALID_CREDENTIALS');
  }

  if (user.status === 'BANNED') {
    throw new AppError('Account has been banned', 403, 'ACCOUNT_BANNED');
  }
  if (user.status === 'SUSPENDED') {
    throw new AppError('Account is suspended', 403, 'ACCOUNT_SUSPENDED');
  }
  if (user.status === 'CLOSED') {
    throw new AppError('Account is closed', 403, 'ACCOUNT_CLOSED');
  }

  const valid = await comparePassword(password, user.passwordHash);
  if (!valid) {
    throw new AppError('Invalid credentials', 401, 'INVALID_CREDENTIALS');
  }

  // Issue tokens
  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user, 'pending');

  // Create session
  const session = await createSession(user.id, refreshToken, req);

  // Re-issue refresh with the actual session id
  const finalRefresh = signRefreshToken(user, session.id);

  // Update refresh token on the session row
  await prisma.session.update({
    where: { id: session.id },
    data: { refreshToken: finalRefresh },
  });

  // Update last login
  await prisma.user.update({
    where: { id: user.id },
    data: {
      lastLoginAt: new Date(),
      lastLoginIp: req.ip || null,
    },
  });

  return {
    user: publicUser(user),
    accessToken,
    refreshToken: finalRefresh,
    expiresIn: config.jwt.accessExpiresIn,
  };
}

/* ============================================================
   REFRESH
   ============================================================ */
async function refresh(refreshToken, req) {
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch (err) {
    throw new AppError('Invalid or expired refresh token', 401, 'REFRESH_INVALID');
  }

  const session = await prisma.session.findUnique({
    where: { refreshToken },
  });

  if (!session || session.revokedAt || session.expiresAt < new Date()) {
    throw new AppError('Session has expired or been revoked', 401, 'SESSION_INVALID');
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user) {
    throw new AppError('User no longer exists', 401, 'USER_NOT_FOUND');
  }
  if (user.status === 'BANNED' || user.status === 'SUSPENDED' || user.status === 'CLOSED') {
    throw new AppError('Account is not active', 403, 'ACCOUNT_INACTIVE');
  }

  // Rotate the access token
  const accessToken = signAccessToken(user);

  // Update last-used timestamp
  await prisma.session.update({
    where: { id: session.id },
    data: { lastUsedAt: new Date() },
  });

  return {
    accessToken,
    expiresIn: config.jwt.accessExpiresIn,
  };
}

/* ============================================================
   LOGOUT
   ============================================================ */
async function logout(refreshToken) {
  if (!refreshToken) {
    throw new AppError('Refresh token is required', 400, 'REFRESH_REQUIRED');
  }

  const session = await prisma.session.findUnique({
    where: { refreshToken },
  });

  if (session) {
    await prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
  }

  return { revoked: true };
}

/* ============================================================
   VERIFY EMAIL
   ============================================================ */
async function verifyEmail({ email, otp }) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    throw new AppError('No account found for that email', 404, 'USER_NOT_FOUND');
  }
  if (user.emailVerified) {
    return publicUser(user);
  }

  const record = otpStore.get(`verify:${user.id}`);
  if (!record) {
    throw new AppError('No pending verification found', 400, 'NO_OTP');
  }
  if (isOTPExpired(record.expiresAt)) {
    otpStore.delete(`verify:${user.id}`);
    throw new AppError('Verification code has expired', 400, 'OTP_EXPIRED');
  }

  const ok = await compareOTP(otp, record.hash);
  if (!ok) {
    throw new AppError('Incorrect verification code', 400, 'OTP_INVALID');
  }

  otpStore.delete(`verify:${user.id}`);

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerified: true,
      emailVerifiedAt: new Date(),
      status: user.status === 'PENDING' ? 'ACTIVE' : user.status,
    },
  });

  return publicUser(updated);
}

/* ============================================================
   RESEND VERIFICATION
   ============================================================ */
async function resendVerification({ email }) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    // Don't leak account existence — always return success
    return { sent: true };
  }
  if (user.emailVerified) {
    throw new AppError('Email is already verified', 400, 'ALREADY_VERIFIED');
  }

  const otp = generateOTP();
  const otpHash = await hashOTP(otp);
  otpStore.set(`verify:${user.id}`, { hash: otpHash, expiresAt: getOTPExpiry() });

  deliverOTP('email', user.email, otp, 'Email verification (resend)');

  const result = { sent: true };
  if (config.isDev) {
    result._devOtp = otp;
    result._devNote = 'OTP shown only because NODE_ENV=development';
  }
  return result;
}

/* ============================================================
   FORGOT PASSWORD
   ============================================================ */
async function forgotPassword({ email }) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    // Don't leak account existence
    return { sent: true };
  }

  const otp = generateOTP();
  const otpHash = await hashOTP(otp);
  otpStore.set(`reset:${user.id}`, { hash: otpHash, expiresAt: getOTPExpiry() });

  deliverOTP('email', user.email, otp, 'Password reset');

  const result = { sent: true };
  if (config.isDev) {
    result._devOtp = otp;
    result._devNote = 'OTP shown only because NODE_ENV=development';
  }
  return result;
}

/* ============================================================
   RESET PASSWORD
   ============================================================ */
async function resetPassword({ email, otp, newPassword }) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    throw new AppError('Invalid reset request', 400, 'INVALID_RESET');
  }

  const record = otpStore.get(`reset:${user.id}`);
  if (!record) {
    throw new AppError('No pending password reset found', 400, 'NO_RESET');
  }
  if (isOTPExpired(record.expiresAt)) {
    otpStore.delete(`reset:${user.id}`);
    throw new AppError('Reset code has expired', 400, 'OTP_EXPIRED');
  }

  const ok = await compareOTP(otp, record.hash);
  if (!ok) {
    throw new AppError('Incorrect reset code', 400, 'OTP_INVALID');
  }

  otpStore.delete(`reset:${user.id}`);

  const passwordHash = await hashPassword(newPassword);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    }),
    // Revoke all sessions so existing logins are killed
    prisma.session.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);

  return { reset: true };
}

/* ============================================================
   CHANGE PASSWORD (authenticated)
   ============================================================ */
async function changePassword(userId, { currentPassword, newPassword }) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.passwordHash) {
    throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  }

  const valid = await comparePassword(currentPassword, user.passwordHash);
  if (!valid) {
    throw new AppError('Current password is incorrect', 400, 'WRONG_PASSWORD');
  }

  const passwordHash = await hashPassword(newPassword);

  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash },
  });

  return { changed: true };
}

/* ============================================================
   GET ME
   ============================================================ */
async function getMe(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      wallets: {
        select: { id: true, currency: true, balance: true, isPrimary: true },
      },
    },
  });

  if (!user) {
    throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  }

  return {
    ...publicUser(user),
    wallets: user.wallets,
  };
}

/* ============================================================
   IN-MEMORY OTP STORE
   ------------------------------------------------------------
   Temporary — will be replaced with a proper table or Redis
   in a later wave. Sufficient for development and single-server
   deployments.
   ============================================================ */
const otpStore = new Map();

// Cleanup expired OTPs every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of otpStore.entries()) {
    if (record.expiresAt && record.expiresAt.getTime() < now) {
      otpStore.delete(key);
    }
  }
}, 5 * 60 * 1000).unref();

module.exports = {
  register,
  login,
  refresh,
  logout,
  verifyEmail,
  resendVerification,
  forgotPassword,
  resetPassword,
  changePassword,
  getMe,
};