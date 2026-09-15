# ============================================================
# CephasGM GameZone — Production Dockerfile
# ============================================================

# ---------- Stage 1: deps ----------
FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
COPY package.json package-lock.json ./
RUN npm ci

# ---------- Stage 2: prod-deps ----------
FROM node:20-alpine AS prod-deps
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---------- Stage 3: builder (generate Prisma) ----------
FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npx prisma generate

# ---------- Stage 4: runner ----------
FROM node:20-alpine AS runner
RUN apk add --no-cache tini openssl libc6-compat

RUN addgroup -g 1001 -S nodejs && \
    adduser -S -u 1001 -G nodejs cephasgm

WORKDIR /app

COPY --from=prod-deps --chown=cephasgm:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=cephasgm:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=cephasgm:nodejs /app/node_modules/@prisma ./node_modules/@prisma

COPY --chown=cephasgm:nodejs package.json package-lock.json ./
COPY --chown=cephasgm:nodejs prisma ./prisma
COPY --chown=cephasgm:nodejs src ./src

RUN mkdir -p /app/logs && chown -R cephasgm:nodejs /app/logs

USER cephasgm
EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://localhost:5000/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "npx prisma migrate deploy && node src/server.js"]