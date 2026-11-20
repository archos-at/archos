FROM oven/bun:1.4.3-slim@sha256:14a223fa35747ec728bce300ef85888bc5f7958164d15bbba6a54b22b52a3288 AS bun

FROM node:22.23.4-bookworm-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d AS deps
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN apt-get update \
    && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts

FROM ghcr.io/puppeteer/puppeteer:25.18.1@sha256:e94e5de180f0488aceebda0e8c32404075c089ec2ac8e9f2f4ec47034a049126 AS renderer
USER root
WORKDIR /app
RUN set -eu; \
    shells="$(find /home/pptruser/.cache/puppeteer/chrome-headless-shell -path '*/chrome-headless-shell-linux64/chrome-headless-shell' -type f)"; \
    [ "$(printf '%s\n' "$shells" | grep -c .)" = 1 ]; \
    ln -s "$shells" /app/chrome-headless-shell
COPY --from=deps /usr/bin/tini-static /usr/bin/tini
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=9222 \
    BROWSER_RENDERER_WORK_DIR=/tmp/browser-renderer \
    BROWSER_RENDERER_CHROME=/app/chrome-headless-shell
COPY --from=deps /app/node_modules/ws ./node_modules/ws
COPY --from=deps /app/node_modules/mermaid/LICENSE /app/node_modules/mermaid/package.json ./node_modules/mermaid/
COPY --from=deps /app/node_modules/mermaid/dist/mermaid.min.js ./node_modules/mermaid/dist/
COPY --from=deps /app/node_modules/source-sans/TTF ./node_modules/source-sans/TTF
COPY --from=deps /app/node_modules/source-sans/LICENSE.md ./node_modules/source-sans/
COPY --from=deps /app/node_modules/source-code-pro/TTF ./node_modules/source-code-pro/TTF
COPY --from=deps /app/node_modules/source-code-pro/LICENSE.md ./node_modules/source-code-pro/
COPY package.json ./
COPY src ./src
USER pptruser
EXPOSE 9222
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "src/server.mjs"]
