FROM node:22.23.4-bookworm-slim AS base
COPY --from=oven/bun:1.4.3-slim /usr/local/bin/bun /usr/local/bin/bun

FROM base AS builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --ignore-scripts
COPY libraries.json config.capnp ./
COPY build ./build
COPY src ./src
RUN node build/build.mjs

FROM base AS prod-deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts

FROM node:22.23.4-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    CODE_RUNNER_STORAGE_DIR=/run/code-runner/do
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && test -s /etc/ssl/certs/ca-certificates.crt \
    && groupadd --system --gid 1001 runner \
    && useradd --system --uid 1001 --gid runner --no-create-home runner \
    && mkdir -p /run/code-runner/do \
    && chown -R runner:runner /run/code-runner \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
COPY --from=prod-deps --chown=runner:runner /app/node_modules ./node_modules
COPY --from=builder --chown=runner:runner /app/dist/worker.js /app/dist/typst-compiler.wasm /app/dist/typst-files.bin /app/dist/forme.wasm ./dist/
COPY --chown=runner:runner package.json config.capnp ./
COPY --chown=runner:runner bin ./bin
USER runner
EXPOSE 8080
CMD ["node", "bin/server.mjs"]
