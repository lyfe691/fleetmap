# syntax=docker/dockerfile:1
# Production image for the Next.js app (dashboard + API routes).
# Multi-stage: install deps -> build standalone -> minimal runtime.

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@11.8.0 --activate

# --- deps: install with a cached pnpm store ---
FROM base AS deps
WORKDIR /app
# pnpm-workspace.yaml carries `allowBuilds` — without it, the install fails with
# ERR_PNPM_IGNORED_BUILDS (native deps like sharp aren't approved to build).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# --- build: compile the standalone server ---
FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# NEXT_PUBLIC_* are inlined into the client bundle at BUILD time, so they must be
# present here (passed as build args from compose). Server-only secrets are NOT
# baked in — they're read from the environment at runtime.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY \
    NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# --- sync: Bubble Box route sync worker (tsx; internal only, no port) ---
FROM base AS sync
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY workers ./workers
COPY lib/bubblebox ./lib/bubblebox
# tsx directly, never `pnpm exec`: pnpm re-runs a deps check on every start,
# which reinstalls without pnpm-workspace.yaml's allowBuilds and exits 1.
CMD ["./node_modules/.bin/tsx", "workers/bubblebox-sync.ts"]

# --- driver-session: BB token → Supabase session exchange (tsx; internal, one Caddy route) ---
FROM base AS driver-session
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY workers ./workers
COPY lib/driver-auth ./lib/driver-auth
COPY lib/bubblebox ./lib/bubblebox
CMD ["./node_modules/.bin/tsx", "workers/driver-session.ts"]

# --- runner: copy only what the standalone server needs ---
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=build /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
