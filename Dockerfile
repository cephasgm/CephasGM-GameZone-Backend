# ============================================================
# CephasGM GameZone — Backend Dockerfile
# ============================================================
# Multi-stage build:
#   Stage 1 (deps)     — install everything (incl. dev) for building
#   Stage 2 (prod-deps)— install ONLY production deps (tiny final image)
#   Stage 3 (builder)  — generate Prisma client
#   Stage 4 (runner)   — final small image with just what runs
# ============================================================

# ------------------------------------------------------------
# Stage 1 — Full dependencies (for build steps)
# ------------------------------------------------------------
FROM node:20-alpine AS deps

WORKDIR /app

# Install libc compat for Prisma on Alpine
RUN apk add --no-cache libc6-compat openssl

COPY package.json package-lock.json ./

# Full install (includes devDeps) — used to generate Prisma client
RUN npm ci

# ------------------------------------------------------------
# Stage 2 — Production-only dependencies
# ------------------------------------------------------------
FROM node:20-alpine AS prod-deps

WORKDIR /app

RUN apk add --no-cache libc6-compat openssl

COPY package.json package-lock.json ./

RUN npm ci --omit=dev && npm cache clean --force

# ------------------------------------------------------------
# Stage 3 — Builder (Prisma client generation)
# ------------------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

RUN apk add --no-cache libc6-compat openssl

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY prisma ./prisma

# Generate the Prisma client matching your schema
RUN npx prisma generate

# ------------------------------------------------------------
# Stage 4 — Runner (final image)
# ------------------------------------------------------------
FROM node:20-alpine AS runner

# Install tini for proper signal handling (clean container shutdown)
RUN apk add --no-cache tini openssl libc6-compat

# Create a non-root user to run the app
RUN addgroup -g 1001 -S nodejs && \
    adduser -S -u 1001 -G nodejs cephasgm

WORKDIR /app

# Copy production node_modules from stage 2
COPY --from=prod-deps --chown=cephasgm:nodejs /app/node_modules ./node_modules

# Overlay the generated Prisma client from stage 3
COPY --from=builder --chown=cephasgm:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=cephasgm:nodejs /app/node_modules/@prisma ./node_modules/@prisma

# Copy source + prisma schema
COPY --chown=cephasgm:nodejs package.json package-lock.json ./
COPY --chown=cephasgm:nodejs prisma ./prisma
COPY --chown=cephasgm:nodejs src ./src

# Ensure logs folder exists and is writable by the app user
RUN mkdir -p /app/logs && chown -R cephasgm:nodejs /app/logs

# Switch to non-root user
USER cephasgm

# Expose the API port
EXPOSE 5000

# Health check — hits a /health endpoint we'll build later
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://localhost:5000/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# Use tini as PID 1 so SIGTERM reaches Node correctly
ENTRYPOINT ["/sbin/tini", "--"]

# Default command: run migrations, then start
CMD ["sh", "-c", "npx prisma migrate deploy && node src/server.js"]