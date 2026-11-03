#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# =============================================================================
# AIQ Blueprint UI - Production Dockerfile
# =============================================================================
#
# Multi-stage build for the Next.js frontend application.
# Public Debian-based Node base (node:22-slim) — no NVIDIA NGC credentials
# needed. Debian (glibc), not Alpine (musl), to avoid native-module surprises.
#
# -----------------------------------------------------------------------------
# BUILD
# -----------------------------------------------------------------------------
#
#   docker build -f deploy/Dockerfile -t frontend:latest .
#
# -----------------------------------------------------------------------------
# RUN
# -----------------------------------------------------------------------------
#
# With WorkOS AuthKit authentication:
#
#   docker run -p 3000:3000 \
#     -e BACKEND_URL=http://backend:8000 \
#     -e BACKEND_CHAT_URL=http://backend-chat:8000 \
#     -e REQUIRE_AUTH=true \
#     -e WORKOS_CLIENT_ID=client_xxx \
#     -e WORKOS_API_KEY=sk_test_xxx \
#     -e WORKOS_REDIRECT_URI=https://your-domain.com/api/auth/callback \
#     -e WORKOS_COOKIE_PASSWORD=$(openssl rand -hex 32) \
#     frontend:latest
#
# Without authentication (development/testing):
#
#   docker run -p 3000:3000 \
#     -e BACKEND_URL=http://backend:8000 \
#     -e BACKEND_CHAT_URL=http://backend-chat:8000 \
#     -e REQUIRE_AUTH=false \
#     frontend:latest
#
# -----------------------------------------------------------------------------
# ENVIRONMENT VARIABLES (all runtime - no rebuild needed)
# -----------------------------------------------------------------------------
#
# Backend:
#   BACKEND_URL                     - Backend api role URL: every HTTP call (default: http://localhost:8000)
#   BACKEND_CHAT_URL                - Backend chat role URL for the WebSocket (required, no default)
#
# Authentication:
#   REQUIRE_AUTH                    - Set to 'true' to require WorkOS AuthKit login (default: false)
#
# WorkOS AuthKit (required if REQUIRE_AUTH=true):
#   WORKOS_CLIENT_ID                - WorkOS client ID
#   WORKOS_API_KEY                  - WorkOS API key
#   WORKOS_REDIRECT_URI             - AuthKit callback URL (default: http://localhost:3000/api/auth/callback)
#   WORKOS_COOKIE_PASSWORD          - 32-byte random string used to encrypt the AuthKit session cookie
#
# =============================================================================

# =============================================================================
# Stage 1: Base with Node.js
# =============================================================================
# node:22-slim already ships Node 22 on Debian bookworm; we only add curl for
# the container HEALTHCHECK (ca-certificates is already present in the image).
FROM node:22-slim AS base

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Bun is the toolchain; Node stays the runtime (ADR-0103). Copied from
# the official image rather than installed, so the layer is deterministic and
# needs no network step.
#
# Do NOT switch the base to an `oven/bun` image and do NOT invoke bun with
# `--bun`: Turbopack evaluates the Tailwind PostCSS loader in a spawned REAL
# `node` process. A bun-only image has no `node` at all, and `--bun` exports
# NODE_OPTIONS=--bun which that child then rejects. Either way `next build`
# dies with a TurbopackInternalError.
#
# Tag choice: `-slim` (Debian bookworm, glibc — matches this node base), not
# `-debian`. Bun does not publish a `-debian` alias for every release (1.3.11
# has none), so that suffix breaks the build on an ordinary version bump.
# The version is the one `.github/actions/setup-bun` pins;
# `tests/test_bun_version_pin.py` fails when they differ.
COPY --from=oven/bun:1.4.3-slim /usr/local/bin/bun /usr/local/bin/bun

# =============================================================================
# Stage 2: Dependencies
# =============================================================================
FROM base AS deps

WORKDIR /app

COPY package.json bun.lock ./
# `patchedDependencies` in package.json: bun applies these while installing.
COPY patches ./patches

RUN bun install --frozen-lockfile --ignore-scripts

# =============================================================================
# Stage 3: Builder
# =============================================================================
FROM base AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Defense-in-depth: remove any env files that may have leaked past .dockerignore
RUN rm -f .env .env.local .env.*.local .env.development .env.production 2>/dev/null || true

ENV NEXT_TELEMETRY_DISABLED=1

# Source maps for PostHog error tracking, on every build, with no key: `next
# build` emits them (EMIT_SOURCE_MAPS, next.config.ts), and the PostHog CLI
# injects a chunk id into each shipped chunk and its map. Without a release
# name the injection contacts nobody; it only insists that credentials exist, so
# placeholders stand in (measured on 0.18.11: with `--release-*` it calls the
# API, without them it logs "injecting chunk ids only" and is done). The ids are
# UUIDv5 of the chunk's content, so an unchanged chunk keeps its id.
#
# Maps and their chunks are copied to /sourcemaps, which only the `sourcemaps`
# stage below reads; CI exports that stage and the Source maps workflow uploads
# it after CI, linked to release `workspace-ui` at GIT_SHA. Uploading here took
# ~232 s of every frontend build on the deploy's critical path, and an image
# built with the key differed from one built without it; now both are the same
# build. Then every map leaves the served trees, with the `sourceMappingURL`
# comments that would point at them (Next serves `.next/static` to anyone, and
# a map carries the original source), and the build fails if a map survives,
# if no map-bearing chunk was kept, or if any kept chunk carries no id. The CLI's npm package fetches its binary on first use;
# it is deleted after, because the production install below does not prune an
# existing node_modules and would ship it.
ARG GIT_SHA=""

RUN EMIT_SOURCE_MAPS=1 bun run build \
    && export POSTHOG_CLI_API_KEY=phx_offline_inject POSTHOG_CLI_PROJECT_ID=0 \
    && node_modules/.bin/posthog-cli sourcemap inject --directory .next/static \
    && node_modules/.bin/posthog-cli sourcemap inject --directory .next/server \
    && rm -rf node_modules/@posthog/cli/node_modules/.bin_real \
    && mkdir -p /sourcemaps \
    && (cd .next && find static server -name '*.map' -type f | while read -r map; do \
         mkdir -p "/sourcemaps/$(dirname "$map")" && cp "$map" "/sourcemaps/$map" || exit 1; \
         if [ -f "${map%.map}" ]; then cp "${map%.map}" "/sourcemaps/${map%.map}" || exit 1; fi; \
       done) \
    && find .next/static .next/server -name '*.map' -type f -delete \
    && find .next/static .next/server -name '*.js' -type f -exec sed -i '/^\/\/# sourceMappingURL=/d' {} + \
    && if find .next/static .next/server -name '*.map' | grep -q .; then echo "error: a source map would ship" >&2; exit 1; fi \
    && if [ ! -d /sourcemaps/static ] || grep -rL 'chunkId=' --include='*.js' /sourcemaps | grep -q .; then \
      echo "error: a source-mapped chunk carries no PostHog chunk id; its stack frames could not be matched" >&2; exit 1; fi

# The deploy-time WorkOS Jobs (deploy/pulumi/src/app/workos-authz-jobs.ts) run
# TypeScript scripts, and the runner keeps neither bun nor tsx. Bundle each to
# one plain ESM file here: `bff/` imports such as the authorization catalog are
# inlined, packages stay imports and resolve from the production node_modules.
RUN for script in provision-workos-authz migrate-folder-grants-to-workos; do \
      bun build "scripts/$script.ts" --target=node --packages=external --format=esm \
        --outfile="dist-scripts/$script.mjs" || exit 1; \
    done

# The `bff-jobs` entry, the same way: our services inlined, packages left to
# the production node_modules. `workers/jobs/index.js` imports it and runs the
# Hatchet worker in process (`bff-job` and the scheduling tasks, ADR-0150). Its
# own script, for the shims Next would otherwise provide.
RUN bun scripts/build-jobs-bundle.ts

# Remove devDependencies — keeps dev-only packages out of the production image
RUN bun install --frozen-lockfile --production --ignore-scripts

# =============================================================================
# Source maps: the maps and chunks the builder kept aside, for CI to export
# (`--target sourcemaps --output type=local`) and upload after the run. Never
# part of the runtime image; it sits before the runner so the runner stays the
# default target.
# =============================================================================
FROM scratch AS sourcemaps
COPY --from=builder /sourcemaps /

# =============================================================================
# Stage 4: Production Runner
# =============================================================================
FROM base AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
# Every Node process of the image reads the old (prefixed) names of the
# environment variables for one release (scripts/legacy-env-names.cjs). A
# deployment that sets NODE_OPTIONS itself must keep this --require in it.
ENV NODE_OPTIONS="--require /app/scripts/legacy-env-names.cjs"

# The commit this image was built from. `--build-arg GIT_SHA=$(git rev-parse
# HEAD)` in the image build (publish-images.yml / docker-build.yml); unset
# everywhere else, and the boot line then prints `sha=unknown` rather than
# guessing. There is no `.git` in the image, so a build arg is the only way the
# running container can answer "which commit am I", and it is the question a
# pilot report cannot be actioned without.
ARG GIT_SHA=""
ENV GIT_SHA=$GIT_SHA

RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/bun

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
# The MCP Apps views the agent door serves as ui:// resources (ADR-0142), built by `bun run build`.
COPY --from=builder --chown=nextjs:nodejs /app/mcp-app-views ./mcp-app-views
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/next.config.ts ./next.config.ts
COPY --from=builder --chown=nextjs:nodejs /app/server.js ./server.js
COPY --from=builder --chown=nextjs:nodejs /app/purger ./purger
COPY --from=builder --chown=nextjs:nodejs /app/observability ./observability
# Shared by purger/ and the bff-jobs worker — both require workers/platform-scope
# to step up to the BYPASSRLS role (ADR-0041). Without it neither worker starts.
COPY --from=builder --chown=nextjs:nodejs /app/workers ./workers
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
COPY --from=builder --chown=nextjs:nodejs /app/dist-scripts ./dist-scripts
COPY --from=builder --chown=nextjs:nodejs /app/dist-jobs ./dist-jobs
# The only source-tree file (besides those below) the runtime needs: the audit action+schema registry the
# deploy-time provisioning script reconciles into WorkOS. It is shared with the
# app (which reaches it through the bundle, not from disk), so it lives in
# bff/audit rather than being duplicated into scripts/.
COPY --from=builder --chown=nextjs:nodejs /app/bff/audit/schemas.mjs ./bff/audit/schemas.mjs
# `next.config.ts` imports these at server start (AVATAR_IMAGE_PATTERNS,
# LOCAL_IMAGE_PATTERNS); Next transpiles the config to
# `next.config.compiled.js`, which then requires the files from disk — missing
# from the image, `server.js` dies with MODULE_NOT_FOUND before ever listening
# (avatar-hosts: update 67 CrashLoopBackOff; optimizable: update 83).
# All three modules must stay import-free (see their file headers) — anything
# they import needs a copy here too.
COPY --from=builder --chown=nextjs:nodejs /app/bff/images/avatar-hosts.ts ./bff/images/avatar-hosts.ts
COPY --from=builder --chown=nextjs:nodejs /app/bff/images/optimizable.ts ./bff/images/optimizable.ts
# The renamed API paths' redirects (`redirects()`); import-free like the two above.
COPY --from=builder --chown=nextjs:nodejs /app/bff/api/legacy-routes.ts ./bff/api/legacy-routes.ts
# The request-body ceiling, which becomes `proxyClientMaxBodySize` and the
# server-action body limit. It has to clear the largest file any route admits —
# an `.ifc` at BIM_MAX_IFC_BYTES, not the 100 MB document limit — or a model is
# cut off in front of the handler and `request.formData()` throws (issue #369).
COPY --from=builder --chown=nextjs:nodejs /app/shared/config/request-body-limit.ts ./shared/config/request-body-limit.ts
# `server.js` requires these three at startup for WebSocket rate limiting
# (ADR-0040 L2b). They are CommonJS precisely so the proxy can load them — the
# same shared catalog the TypeScript side imports — which means they must be on
# disk in the runtime image, not merely inside the Next bundle. Missing, the
# gateway dies with MODULE_NOT_FOUND before it ever listens (the failure mode
# that took the avatar-hosts copy above to learn).
COPY --from=builder --chown=nextjs:nodejs /app/bff/limits/rules.js ./bff/limits/rules.js
COPY --from=builder --chown=nextjs:nodejs /app/bff/limits/factory.js ./bff/limits/factory.js
COPY --from=builder --chown=nextjs:nodejs /app/bff/limits/ws-frames.js ./bff/limits/ws-frames.js
# Same reason: `server.js` requires it to strip client-sent x-grid-* headers from
# the WebSocket upgrade. `server-js-runtime-copies.spec.ts` fails when a
# `server.js` require has no COPY line here.
COPY --from=builder --chown=nextjs:nodejs /app/bff/proxy/ws-upgrade-headers.js ./bff/proxy/ws-upgrade-headers.js
# And this one to classify and log WebSocket teardown after the upgrade.
COPY --from=builder --chown=nextjs:nodejs /app/bff/proxy/ws-teardown.js ./bff/proxy/ws-teardown.js
# And this one to pick which chat address a chat socket dials (ADR-0080).
COPY --from=builder --chown=nextjs:nodejs /app/bff/proxy/backend-target.js ./bff/proxy/backend-target.js
# And this one to build a chat turn's headers and signed envelope (ADR-0106).
COPY --from=builder --chown=nextjs:nodejs /app/bff/turns/turn-headers.js ./bff/turns/turn-headers.js
# And this one to open the shared rate-limit store's Dragonfly connection.
COPY --from=builder --chown=nextjs:nodejs /app/bff/redis/connect.js ./bff/redis/connect.js
COPY --from=builder --chown=nextjs:nodejs /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder --chown=nextjs:nodejs /app/migrations ./migrations

USER nextjs

EXPOSE 3000

# Probe the dependency-free liveness endpoint, not `/`. `/` does a full dynamic
# SSR render and can be slow on a cold container; `/api/healthz` returns a tiny
# 200 as soon as the server is listening. The generous start period covers the
# `drizzle-kit migrate` step that runs before the server starts (see CMD).
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=5 \
    CMD curl -f http://localhost:3000/api/healthz || exit 1

# Provision the row-level-security roles, THEN migrate, then serve (ADR-0041).
# The order is load-bearing: migration 0030 asserts the roles exist and aborts
# if they do not, and `init-db.sql` only runs when Postgres initialises a FRESH
# data directory — so on an upgraded stack nothing else would ever create them
# and the container would never start. The step is idempotent and fail-soft.
CMD ["sh", "-c", "node scripts/ensure-rls-roles.mjs && node node_modules/drizzle-kit/bin.cjs migrate && node server.js"]
