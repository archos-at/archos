# =============================================================================
# The website's CMS (Payload on Next.js, ADR-0155): production image
# =============================================================================
#
# Built by CI like the other apps (ci/image_inputs.py, `grid-oib-cms`) and run by
# deploy/pulumi/src/platform/cms.ts: `node server.js` from Next's standalone
# output, port 3000, UID 1001, a read-only root with Next's cache and /tmp
# mounted writable. Payload applies its migrations when the server starts
# (`prodMigrations` in src/payload.config.ts) and provisions its robots and the
# first administrator (`onInit`, src/provision.ts), so the image needs no step
# before it and no Job beside it.
#
# The base is the floating `node:22-slim`, as for apps/website and
# apps/workspace: ci/image_inputs.py puts the ISO week into the image's hash, so
# a patched base reaches this image within seven days without a pin to move.
#
# Configuration is the environment at run time (docs/deployment/environment-variables.md,
# "The website's CMS"); nothing is baked in.
# =============================================================================

FROM node:22-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
# Bun is the toolchain, Node the runtime (ADR-0103); the version is the one
# .github/actions/setup-bun pins (tests/test_bun_version_pin.py).
COPY --from=oven/bun:1.4.3-slim /usr/local/bin/bun /usr/local/bin/bun

FROM base AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN rm -f .env .env.local .env.*.local .env.development .env.production 2>/dev/null || true
ENV NEXT_TELEMETRY_DISABLED=1
RUN bun run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/bun
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=5 \
    CMD curl -sf http://localhost:3000/healthz || exit 1
CMD ["node", "server.js"]
