require('dotenv').config();

const url = process.env.DATABASE_URL;
console.log('DATABASE_URL:', JSON.stringify(url));
console.log('Length:', url?.length);
console.log('Has quotes?', url?.includes('"'));
console.log('');

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

prisma.$queryRaw`SELECT 1 as ok`
  .then(r => {
    console.log('✅ Prisma connected:', r);
    return prisma.$disconnect();
  })
  .catch(e => {
    console.log('❌ Prisma error:', e.message);
    return prisma.$disconnect();
  });