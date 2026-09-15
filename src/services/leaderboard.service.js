/**
 * ============================================================
 * CephasGM GameZone — Leaderboard Service
 * ============================================================
 * Ranks users across four metrics:
 *   • winnings   — total amount won in the period
 *   • wagered    — total amount staked in the period
 *   • referrals  — number of users referred in the period
 *   • vipPoints  — current VIP point total (all-time)
 *
 * Periods: daily, weekly, monthly, alltime.
 * ============================================================
 */

'use strict';

const prisma = require('../config/database');
const { AppError } = require('../utils/AppError');

/* ------------------------------------------------------------
   Period → start date
   ------------------------------------------------------------ */
function startOfPeriod(period) {
  const now = new Date();
  switch (period) {
    case 'daily': {
      const d = new Date(now);
      d.setUTCHours(0, 0, 0, 0);
      return d;
    }
    case 'weekly': {
      const d = new Date(now);
      const day = d.getUTCDay();
      d.setUTCDate(d.getUTCDate() - day);
      d.setUTCHours(0, 0, 0, 0);
      return d;
    }
    case 'monthly': {
      const d = new Date(now);
      d.setUTCDate(1);
      d.setUTCHours(0, 0, 0, 0);
      return d;
    }
    case 'alltime':
    default:
      return null;
  }
}

/* ============================================================
   GET TOP
   ============================================================ */
async function getTop({ period = 'weekly', metric = 'winnings', limit = 20 } = {}) {
  const start = startOfPeriod(period);

  let rows;

  if (metric === 'vipPoints') {
    /* Live from user table — no time filter applicable */
    rows = await prisma.user.findMany({
      where: { status: 'ACTIVE', deletedAt: null },
      orderBy: { vipPoints: 'desc' },
      take: limit,
      select: {
        id: true,
        username: true,
        fullName: true,
        avatarUrl: true,
        vipTier: true,
        vipPoints: true,
        country: true,
      },
    });

    return rows.map((u, i) => ({
      rank: i + 1,
      userId: u.id,
      username: u.username,
      fullName: u.fullName,
      avatarUrl: u.avatarUrl,
      vipTier: u.vipTier,
      country: u.country,
      value: String(u.vipPoints),
    }));
  }

  if (metric === 'referrals') {
    /* Count referrals per referrer */
    const where = start ? { createdAt: { gte: start } } : {};
    const grouped = await prisma.referral.groupBy({
      by: ['referrerId'],
      where,
      _count: { referrerId: true },
      orderBy: { _count: { referrerId: 'desc' } },
      take: limit,
    });

    const userIds = grouped.map((g) => g.referrerId);
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, username: true, fullName: true, avatarUrl: true, vipTier: true, country: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    return grouped.map((g, i) => {
      const u = userMap.get(g.referrerId) || {};
      return {
        rank: i + 1,
        userId: g.referrerId,
        username: u.username,
        fullName: u.fullName,
        avatarUrl: u.avatarUrl,
        vipTier: u.vipTier,
        country: u.country,
        value: String(g._count.referrerId),
      };
    });
  }

  /* winnings OR wagered — derived from Bet table */
  const where = {
    status: metric === 'winnings' ? 'WON' : { in: ['WON', 'LOST', 'CASHED_OUT'] },
  };
  if (start) where.createdAt = { gte: start };

  const sumField = metric === 'winnings' ? 'actualWin' : 'stake';

  /* Prisma groupBy supports _sum on numeric fields */
  const grouped = await prisma.bet.groupBy({
    by: ['userId'],
    where,
    _sum: { [sumField]: true },
    orderBy: { _sum: { [sumField]: 'desc' } },
    take: limit,
  });

  const userIds = grouped.map((g) => g.userId);
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, username: true, fullName: true, avatarUrl: true, vipTier: true, country: true },
  });
  const userMap = new Map(users.map((u) => [u.id, u]));

  return grouped.map((g, i) => {
    const u = userMap.get(g.userId) || {};
    return {
      rank: i + 1,
      userId: g.userId,
      username: u.username,
      fullName: u.fullName,
      avatarUrl: u.avatarUrl,
      vipTier: u.vipTier,
      country: u.country,
      value: (g._sum[sumField] || 0).toString(),
    };
  });
}

/* ============================================================
   GET MY RANK
   ============================================================ */
async function getMyRank(userId, { period = 'weekly', metric = 'winnings' } = {}) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, vipPoints: true, vipTier: true },
  });
  if (!user) throw new AppError('User not found', 404, 'USER_NOT_FOUND');

  /* Get everyone's value for this metric, then find my position */
  const all = await getTop({ period, metric, limit: 1000 });
  const me = all.find((row) => row.userId === userId);

  if (me) return me;

  /* Not in top 1000 — compute my raw value */
  if (metric === 'vipPoints') {
    return { rank: null, userId, value: String(user.vipPoints), vipTier: user.vipTier };
  }

  return { rank: null, userId, value: '0' };
}

module.exports = { getTop, getMyRank };