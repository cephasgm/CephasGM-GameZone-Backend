/**
 * ============================================================
 * CephasGM GameZone — Environment Configuration
 * ============================================================
 * Loads .env → validates every variable with Zod → exports a
 * frozen, typed config object.
 *
 * Rules:
 *   • Never read process.env directly anywhere else in the app.
 *   • If a required var is missing or invalid, fail loudly at boot.
 *   • Secrets are never logged.
 * ============================================================
 */

'use strict';

const path = require('path');
const { z } = require('zod');

// Ensure .env is loaded (server.js already does this, but config
// files are sometimes required directly in tests / scripts)
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

/* ------------------------------------------------------------
   Small helpers to coerce env strings into typed values
   ------------------------------------------------------------ */
const toBool = (defaultVal) =>
  z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined || v === '') return defaultVal;
      return ['true', '1', 'yes', 'on'].includes(String(v).toLowerCase());
    });

const toInt = (defaultVal) =>
  z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined || v === '') return defaultVal;
      const n = Number(v);
      if (Number.isNaN(n)) throw new Error(`Expected number, got "${v}"`);
      return Math.trunc(n);
    });

const toFloat = (defaultVal) =>
  z
    .string()
    .optional()
    .transform((v) => {
      if (v === undefined || v === '') return defaultVal;
      const n = Number(v);
      if (Number.isNaN(n)) throw new Error(`Expected number, got "${v}"`);
      return n;
    });

const toList = (defaultVal = []) =>
  z
    .string()
    .optional()
    .transform((v) => {
      if (!v) return defaultVal;
      return v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    });

/* ------------------------------------------------------------
   Schema — every environment variable we expect
   ------------------------------------------------------------ */
const envSchema = z.object({
  /* ---------- APP ---------- */
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: toInt(5000),
  API_PREFIX: z.string().default('/api/v1'),
  APP_NAME: z.string().default('CephasGM GameZone'),
  APP_URL: z.string().url().default('http://localhost:5000'),
  FRONTEND_URL: z.string().url().default('http://localhost:5500'),
  CORS_ORIGINS: toList([
    'http://localhost:5500',
    'http://localhost:3000',
    'http://127.0.0.1:5500',
  ]),

  /* ---------- DATABASE ---------- */
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required')
    .refine(
      (v) => v.startsWith('postgresql://') || v.startsWith('postgres://'),
      'DATABASE_URL must be a postgres:// or postgresql:// URL'
    ),

  /* ---------- JWT ---------- */
  JWT_ACCESS_SECRET: z
    .string()
    .min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_SECRET: z
    .string()
    .min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),
  BCRYPT_ROUNDS: toInt(12),

  /* ---------- OTP ---------- */
  OTP_LENGTH: toInt(6),
  OTP_EXPIRES_MINUTES: toInt(10),
  EMAIL_VERIFICATION_EXPIRES_HOURS: toInt(24),
  PASSWORD_RESET_EXPIRES_MINUTES: toInt(30),

  /* ---------- RATE LIMIT ---------- */
  RATE_LIMIT_WINDOW_MS: toInt(900_000),
  RATE_LIMIT_MAX: toInt(100),
  AUTH_RATE_LIMIT_MAX: toInt(10),
  BET_RATE_LIMIT_MAX: toInt(30),

  /* ---------- EMAIL ---------- */
  MAIL_HOST: z.string().default('smtp.gmail.com'),
  MAIL_PORT: toInt(587),
  MAIL_SECURE: toBool(false),
  MAIL_USER: z.string().optional().default(''),
  MAIL_PASSWORD: z.string().optional().default(''),
  MAIL_FROM_NAME: z.string().default('CephasGM GameZone'),
  MAIL_FROM_ADDRESS: z
    .string()
    .default('no-reply@cephasgm.com'),

  /* ---------- SMS ---------- */
  SMS_PROVIDER: z.enum(['africastalking', 'twilio', 'none']).default('none'),
  AT_USERNAME: z.string().optional().default(''),
  AT_API_KEY: z.string().optional().default(''),
  AT_SENDER_ID: z.string().optional().default('CEPHASGM'),
  TWILIO_ACCOUNT_SID: z.string().optional().default(''),
  TWILIO_AUTH_TOKEN: z.string().optional().default(''),
  TWILIO_PHONE_NUMBER: z.string().optional().default(''),

  /* ---------- CLOUDINARY ---------- */
  CLOUDINARY_CLOUD_NAME: z.string().optional().default(''),
  CLOUDINARY_API_KEY: z.string().optional().default(''),
  CLOUDINARY_API_SECRET: z.string().optional().default(''),
  CLOUDINARY_UPLOAD_FOLDER: z.string().default('cephasgm/kyc'),

  /* ---------- PAYMENTS ---------- */
  FLUTTERWAVE_PUBLIC_KEY: z.string().optional().default(''),
  FLUTTERWAVE_SECRET_KEY: z.string().optional().default(''),
  FLUTTERWAVE_ENCRYPTION_KEY: z.string().optional().default(''),
  FLUTTERWAVE_WEBHOOK_HASH: z.string().optional().default(''),
  FLUTTERWAVE_BASE_URL: z
    .string()
    .url()
    .default('https://api.flutterwave.com/v3'),

  MPESA_CONSUMER_KEY: z.string().optional().default(''),
  MPESA_CONSUMER_SECRET: z.string().optional().default(''),
  MPESA_PASSKEY: z.string().optional().default(''),
  MPESA_SHORTCODE: z.string().optional().default(''),
  MPESA_ENVIRONMENT: z.enum(['sandbox', 'production']).default('sandbox'),
  MPESA_CALLBACK_URL: z.string().optional().default(''),

  TIGO_PESA_API_KEY: z.string().optional().default(''),
  TIGO_PESA_API_SECRET: z.string().optional().default(''),
  TIGO_PESA_MERCHANT_ID: z.string().optional().default(''),

  AIRTEL_CLIENT_ID: z.string().optional().default(''),
  AIRTEL_CLIENT_SECRET: z.string().optional().default(''),
  AIRTEL_MERCHANT_ID: z.string().optional().default(''),

  /* ---------- WALLET / BETTING RULES ---------- */
  DEFAULT_CURRENCY: z.string().default('TZS'),
  MIN_DEPOSIT: toInt(1_000),
  MAX_DEPOSIT: toInt(5_000_000),
  MIN_WITHDRAWAL: toInt(5_000),
  MAX_WITHDRAWAL: toInt(10_000_000),
  MIN_BET: toInt(500),
  MAX_BET: toInt(1_000_000),
  WITHDRAWAL_FEE_PERCENT: toFloat(2),
  HOUSE_EDGE_PERCENT: toFloat(5),

  /* ---------- VIRTUAL GAMES ---------- */
  VIRTUAL_ROUND_INTERVAL_MS: toInt(60_000),
  AVIATOR_MIN_CRASH: toFloat(1.0),
  AVIATOR_MAX_CRASH: toFloat(60.0),
  AVIATOR_HOUSE_EDGE: toFloat(0.04),
  PROVABLY_FAIR_SERVER_SEED: z
    .string()
    .min(16, 'PROVABLY_FAIR_SERVER_SEED must be at least 16 characters'),

  /* ---------- BONUSES / REFERRALS ---------- */
  WELCOME_BONUS_AMOUNT: toInt(5_000),
  WELCOME_BONUS_WAGER_MULTIPLIER: toInt(5),
  REFERRAL_COMMISSION_PERCENT: toFloat(5),
  REFERRAL_MIN_DEPOSIT: toInt(5_000),

  /* ---------- VIP ---------- */
  VIP_TIERS: toList(['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond']),
  VIP_BRONZE_THRESHOLD: toInt(0),
  VIP_SILVER_THRESHOLD: toInt(100_000),
  VIP_GOLD_THRESHOLD: toInt(500_000),
  VIP_PLATINUM_THRESHOLD: toInt(2_000_000),
  VIP_DIAMOND_THRESHOLD: toInt(10_000_000),

  /* ---------- LOGGING ---------- */
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  LOG_PRETTY: toBool(true),
  LOG_FILE: z.string().default('logs/app.log'),

  /* ---------- SECURITY ---------- */
  COOKIE_SECRET: z
    .string()
    .min(16, 'COOKIE_SECRET must be at least 16 characters'),
  SESSION_SECRET: z
    .string()
    .min(16, 'SESSION_SECRET must be at least 16 characters'),

  /* ---------- ADMIN BOOTSTRAP ---------- */
  ADMIN_EMAIL: z.string().email().default('admin@cephasgm.com'),
  ADMIN_PASSWORD: z.string().min(8).default('ChangeMe_Str0ng!Pass'),
  ADMIN_PHONE: z.string().default('+255700000000'),

  /* ---------- REDIS ---------- */
  REDIS_URL: z.string().default('redis://localhost:6379'),
  REDIS_ENABLED: toBool(false),
});

/* ------------------------------------------------------------
   Validate
   ------------------------------------------------------------ */
const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  • ${i.path.join('.')}: ${i.message}`)
    .join('\n');

  // Use console.error here — the logger depends on config, so we
  // can't use it yet. This runs before logging is available.
  // eslint-disable-next-line no-console
  console.error(
    '\n❌ Invalid environment configuration:\n' + issues + '\n\n' +
    'Fix the values in your .env file and restart.\n' +
    'See .env.example for the full list of expected variables.\n'
  );
  process.exit(1);
}

const env = parsed.data;

/* ------------------------------------------------------------
   Build the frozen config object
   ------------------------------------------------------------ */
const config = Object.freeze({
  /* ---------- App ---------- */
  env: env.NODE_ENV,
  isDev: env.NODE_ENV === 'development',
  isProd: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
  port: env.PORT,
  apiPrefix: env.API_PREFIX,
  appName: env.APP_NAME,
  appUrl: env.APP_URL,
  frontendUrl: env.FRONTEND_URL,
  corsOrigins: env.CORS_ORIGINS,

  /* ---------- Database ---------- */
  databaseUrl: env.DATABASE_URL,

  /* ---------- JWT ---------- */
  jwt: {
    accessSecret: env.JWT_ACCESS_SECRET,
    accessExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
    refreshSecret: env.JWT_REFRESH_SECRET,
    refreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
  },
  bcryptRounds: env.BCRYPT_ROUNDS,

  /* ---------- OTP ---------- */
  otp: {
    length: env.OTP_LENGTH,
    expiresMinutes: env.OTP_EXPIRES_MINUTES,
    emailVerificationExpiresHours: env.EMAIL_VERIFICATION_EXPIRES_HOURS,
    passwordResetExpiresMinutes: env.PASSWORD_RESET_EXPIRES_MINUTES,
  },

  /* ---------- Rate limiting ---------- */
  rateLimit: {
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX,
    authMax: env.AUTH_RATE_LIMIT_MAX,
    betMax: env.BET_RATE_LIMIT_MAX,
  },

  /* ---------- Email ---------- */
  mail: {
    host: env.MAIL_HOST,
    port: env.MAIL_PORT,
    secure: env.MAIL_SECURE,
    user: env.MAIL_USER,
    password: env.MAIL_PASSWORD,
    fromName: env.MAIL_FROM_NAME,
    fromAddress: env.MAIL_FROM_ADDRESS,
    enabled: Boolean(env.MAIL_USER && env.MAIL_PASSWORD),
  },

  /* ---------- SMS ---------- */
  sms: {
    provider: env.SMS_PROVIDER,
    africastalking: {
      username: env.AT_USERNAME,
      apiKey: env.AT_API_KEY,
      senderId: env.AT_SENDER_ID,
    },
    twilio: {
      accountSid: env.TWILIO_ACCOUNT_SID,
      authToken: env.TWILIO_AUTH_TOKEN,
      phoneNumber: env.TWILIO_PHONE_NUMBER,
    },
    enabled:
      env.SMS_PROVIDER !== 'none' &&
      ((env.SMS_PROVIDER === 'africastalking' && env.AT_API_KEY) ||
        (env.SMS_PROVIDER === 'twilio' && env.TWILIO_AUTH_TOKEN)),
  },

  /* ---------- Cloudinary ---------- */
  cloudinary: {
    cloudName: env.CLOUDINARY_CLOUD_NAME,
    apiKey: env.CLOUDINARY_API_KEY,
    apiSecret: env.CLOUDINARY_API_SECRET,
    uploadFolder: env.CLOUDINARY_UPLOAD_FOLDER,
    enabled: Boolean(
      env.CLOUDINARY_CLOUD_NAME &&
      env.CLOUDINARY_API_KEY &&
      env.CLOUDINARY_API_SECRET
    ),
  },

  /* ---------- Payments ---------- */
  payments: {
    flutterwave: {
      publicKey: env.FLUTTERWAVE_PUBLIC_KEY,
      secretKey: env.FLUTTERWAVE_SECRET_KEY,
      encryptionKey: env.FLUTTERWAVE_ENCRYPTION_KEY,
      webhookHash: env.FLUTTERWAVE_WEBHOOK_HASH,
      baseUrl: env.FLUTTERWAVE_BASE_URL,
      enabled: Boolean(env.FLUTTERWAVE_SECRET_KEY),
    },
    mpesa: {
      consumerKey: env.MPESA_CONSUMER_KEY,
      consumerSecret: env.MPESA_CONSUMER_SECRET,
      passkey: env.MPESA_PASSKEY,
      shortcode: env.MPESA_SHORTCODE,
      environment: env.MPESA_ENVIRONMENT,
      callbackUrl: env.MPESA_CALLBACK_URL,
      enabled: Boolean(env.MPESA_CONSUMER_KEY && env.MPESA_CONSUMER_SECRET),
    },
    tigoPesa: {
      apiKey: env.TIGO_PESA_API_KEY,
      apiSecret: env.TIGO_PESA_API_SECRET,
      merchantId: env.TIGO_PESA_MERCHANT_ID,
      enabled: Boolean(env.TIGO_PESA_API_KEY),
    },
    airtel: {
      clientId: env.AIRTEL_CLIENT_ID,
      clientSecret: env.AIRTEL_CLIENT_SECRET,
      merchantId: env.AIRTEL_MERCHANT_ID,
      enabled: Boolean(env.AIRTEL_CLIENT_ID && env.AIRTEL_CLIENT_SECRET),
    },
  },

  /* ---------- Wallet / Betting rules ---------- */
  wallet: {
    defaultCurrency: env.DEFAULT_CURRENCY,
    minDeposit: env.MIN_DEPOSIT,
    maxDeposit: env.MAX_DEPOSIT,
    minWithdrawal: env.MIN_WITHDRAWAL,
    maxWithdrawal: env.MAX_WITHDRAWAL,
    minBet: env.MIN_BET,
    maxBet: env.MAX_BET,
    withdrawalFeePercent: env.WITHDRAWAL_FEE_PERCENT,
    houseEdgePercent: env.HOUSE_EDGE_PERCENT,
  },

  /* ---------- Virtual Games ---------- */
  games: {
    roundIntervalMs: env.VIRTUAL_ROUND_INTERVAL_MS,
    aviator: {
      minCrash: env.AVIATOR_MIN_CRASH,
      maxCrash: env.AVIATOR_MAX_CRASH,
      houseEdge: env.AVIATOR_HOUSE_EDGE,
    },
    provablyFairSeed: env.PROVABLY_FAIR_SERVER_SEED,
  },

  /* ---------- Bonuses / Referrals ---------- */
  bonuses: {
    welcomeAmount: env.WELCOME_BONUS_AMOUNT,
    welcomeWagerMultiplier: env.WELCOME_BONUS_WAGER_MULTIPLIER,
  },
  referrals: {
    commissionPercent: env.REFERRAL_COMMISSION_PERCENT,
    minDeposit: env.REFERRAL_MIN_DEPOSIT,
  },

  /* ---------- VIP ---------- */
  vip: {
    tiers: env.VIP_TIERS,
    thresholds: {
      Bronze: env.VIP_BRONZE_THRESHOLD,
      Silver: env.VIP_SILVER_THRESHOLD,
      Gold: env.VIP_GOLD_THRESHOLD,
      Platinum: env.VIP_PLATINUM_THRESHOLD,
      Diamond: env.VIP_DIAMOND_THRESHOLD,
    },
  },

  /* ---------- Logging ---------- */
  log: {
    level: env.LOG_LEVEL,
    pretty: env.LOG_PRETTY,
    file: env.LOG_FILE,
  },

  /* ---------- Security ---------- */
  cookieSecret: env.COOKIE_SECRET,
  sessionSecret: env.SESSION_SECRET,

  /* ---------- Admin bootstrap ---------- */
  admin: {
    email: env.ADMIN_EMAIL,
    password: env.ADMIN_PASSWORD,
    phone: env.ADMIN_PHONE,
  },

  /* ---------- Redis ---------- */
  redis: {
    url: env.REDIS_URL,
    enabled: env.REDIS_ENABLED,
  },
});

module.exports = config;