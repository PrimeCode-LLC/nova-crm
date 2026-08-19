# Dockerfile — Nova CRM web tier (Next.js)
# Multi-stage build. Requires next.config.js to have: output: 'standalone'

# ---------- Base ----------
FROM node:22-alpine AS base
WORKDIR /app
RUN apk add --no-cache libc6-compat

# ---------- Dependencies ----------
FROM base AS deps
COPY package.json package-lock.json ./
COPY packages/nova-scoring/package.json packages/nova-scoring/package.json
COPY extension/package.json extension/package.json
RUN npm ci --ignore-scripts

# ---------- Build ----------
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Client bundle inlines NEXT_PUBLIC_* at build time — pass via compose/CI build args.
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_AUTH_CLERK_V1=true
ARG NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
ARG NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_SITE_NAME=Nova CRM
ARG NEXT_PUBLIC_POSTGRES_READ_CRM_V1=true
ARG NEXT_PUBLIC_POSTGRES_READ_LEADS_V1=true
ARG NEXT_PUBLIC_POSTGRES_SOLE_WRITER_CRM_V1=true
ARG NEXT_PUBLIC_POSTGRES_DASHBOARD_SUMMARY_READ_V1=true

ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_AUTH_CLERK_V1=$NEXT_PUBLIC_AUTH_CLERK_V1
ENV NEXT_PUBLIC_CLERK_SIGN_IN_URL=$NEXT_PUBLIC_CLERK_SIGN_IN_URL
ENV NEXT_PUBLIC_CLERK_SIGN_UP_URL=$NEXT_PUBLIC_CLERK_SIGN_UP_URL
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_SITE_NAME=$NEXT_PUBLIC_SITE_NAME
ENV NEXT_PUBLIC_POSTGRES_READ_CRM_V1=$NEXT_PUBLIC_POSTGRES_READ_CRM_V1
ENV NEXT_PUBLIC_POSTGRES_READ_LEADS_V1=$NEXT_PUBLIC_POSTGRES_READ_LEADS_V1
ENV NEXT_PUBLIC_POSTGRES_SOLE_WRITER_CRM_V1=$NEXT_PUBLIC_POSTGRES_SOLE_WRITER_CRM_V1
ENV NEXT_PUBLIC_POSTGRES_DASHBOARD_SUMMARY_READ_V1=$NEXT_PUBLIC_POSTGRES_DASHBOARD_SUMMARY_READ_V1

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN npx prisma generate
RUN npm run build

# ---------- Runtime ----------
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

# Next.js standalone output only ships what's needed to run — small image, no dev deps
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Basic container-level healthcheck; pair with a real /api/health route
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
