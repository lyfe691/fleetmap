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

# --- worker-build: bundle each worker to one self-contained ESM file ---
FROM base AS worker-build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY workers ./workers
COPY lib ./lib
RUN ./node_modules/.bin/esbuild \
      workers/bubblebox-sync.ts workers/driver-session.ts \
      --bundle --platform=node --target=node22 --format=esm \
      --outdir=/workers --out-extension:.js=.mjs \
      --banner:js="import{createRequire}from'module';const require=createRequire(import.meta.url);"

# --- worker-base: node only. No pnpm, no node_modules, no TypeScript at runtime ---
FROM node:22-bookworm-slim AS worker-base
WORKDIR /app
USER node

# --- sync: Bubble Box route sync worker (internal only, no port) ---
FROM worker-base AS sync
COPY --from=worker-build /workers/bubblebox-sync.mjs ./
CMD ["node", "bubblebox-sync.mjs"]

# --- driver-session: BB token → Supabase session exchange (internal, one Caddy route) ---
FROM worker-base AS driver-session
COPY --from=worker-build /workers/driver-session.mjs ./
CMD ["node", "driver-session.mjs"]

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
