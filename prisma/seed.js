'use strict';

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
require('dotenv').config();

const prisma = new PrismaClient();

function generateReferralCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

async function main() {
  console.log('Seeding database...\n');

  const adminEmail = process.env.ADMIN_EMAIL || 'admin@cephasgm.com';
  const adminPassword = process.env.ADMIN_PASSWORD || 'ChangeMe_Str0ng!Pass';
  const adminPhone = process.env.ADMIN_PHONE || '+255700000000';

  const passwordHash = await bcrypt.hash(adminPassword, 12);

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      role: 'SUPERADMIN',
      status: 'ACTIVE',
      emailVerified: true,
      phoneVerified: true,
    },
    create: {
      email: adminEmail,
      phone: adminPhone,
      username: 'cephasgm',
      passwordHash,
      fullName: 'CephasGM Administrator',
      country: 'TZ',
      currency: 'TZS',
      role: 'SUPERADMIN',
      status: 'ACTIVE',
      emailVerified: true,
      phoneVerified: true,
      emailVerifiedAt: new Date(),
      phoneVerifiedAt: new Date(),
      kycStatus: 'APPROVED',
      kycVerifiedAt: new Date(),
      vipTier: 'DIAMOND',
      referralCode: generateReferralCode(),
    },
  });

  console.log('Admin user: ' + admin.email);

  const wallet = await prisma.wallet.upsert({
    where: {
      userId_currency: { userId: admin.id, currency: 'TZS' },
    },
    update: {},
    create: {
      userId: admin.id,
      currency: 'TZS',
      balance: 0,
      isPrimary: true,
    },
  });

  console.log('Admin wallet: ' + wallet.id);

  const welcomeBonus = await prisma.bonus.upsert({
    where: { code: 'WELCOME100' },
    update: {},
    create: {
      code: 'WELCOME100',
      name: 'Welcome Bonus',
      description: 'Get a 100% match on your first deposit up to TZS 50,000. Wager 5x to withdraw.',
      type: 'WELCOME',
      amount: 50000,
      percentage: 100,
      maxAmount: 50000,
      minDeposit: 5000,
      wagerMultiplier: 5,
      maxBetAmount: 50000,
      active: true,
      isPublic: true,
    },
  });
  console.log('Bonus: ' + welcomeBonus.name);

  const depositMatch = await prisma.bonus.upsert({
    where: { code: 'DEPOSIT50' },
    update: {},
    create: {
      code: 'DEPOSIT50',
      name: '50% Deposit Match',
      description: 'Get 50% extra on deposits of TZS 10,000 or more.',
      type: 'DEPOSIT_MATCH',
      amount: 25000,
      percentage: 50,
      maxAmount: 25000,
      minDeposit: 10000,
      wagerMultiplier: 3,
      maxBetAmount: 25000,
      active: true,
      isPublic: true,
    },
  });
  console.log('Bonus: ' + depositMatch.name);

  const freeBet = await prisma.bonus.upsert({
    where: { code: 'FREEBET5K' },
    update: {},
    create: {
      code: 'FREEBET5K',
      name: 'TZS 5,000 Free Bet',
      description: 'A free TZS 5,000 bet on any sports market.',
      type: 'FREE_BET',
      amount: 5000,
      wagerMultiplier: 1,
      maxBetAmount: 5000,
      active: true,
      isPublic: true,
    },
  });
  console.log('Bonus: ' + freeBet.name);

  const referralBonus = await prisma.bonus.upsert({
    where: { code: 'REFER5' },
    update: {},
    create: {
      code: 'REFER5',
      name: 'Referral Reward',
      description: 'Earn 5% of every bet your referred friends place.',
      type: 'REFERRAL',
      amount: 0,
      percentage: 5,
      wagerMultiplier: 0,
      active: true,
      isPublic: false,
    },
  });
  console.log('Bonus: ' + referralBonus.name);

  if (process.env.NODE_ENV !== 'production') {
    const demoHash = await bcrypt.hash('Demo1234!', 12);
    const demo = await prisma.user.upsert({
      where: { email: 'demo@cephasgm.com' },
      update: {},
      create: {
        email: 'demo@cephasgm.com',
        phone: '+255712345678',
        username: 'demo',
        passwordHash: demoHash,
        fullName: 'Demo Player',
        country: 'TZ',
        currency: 'TZS',
        role: 'USER',
        status: 'ACTIVE',
        emailVerified: true,
        phoneVerified: true,
        emailVerifiedAt: new Date(),
        phoneVerifiedAt: new Date(),
        referralCode: generateReferralCode(),
      },
    });

    await prisma.wallet.upsert({
      where: {
        userId_currency: { userId: demo.id, currency: 'TZS' },
      },
      update: {},
      create: {
        userId: demo.id,
        currency: 'TZS',
        balance: 100000,
        isPrimary: true,
      },
    });

    console.log('Demo user: ' + demo.email);
  }

  console.log('\nSeed complete!');
  console.log('-----------------------------------------');
  console.log('Admin login:');
  console.log('  Email:    ' + adminEmail);
  console.log('  Password: ' + adminPassword);
  console.log('-----------------------------------------');
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('Seed failed:', err);
    await prisma.$disconnect();
    process.exit(1);
  });