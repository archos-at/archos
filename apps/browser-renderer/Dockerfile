FROM node:22.23.4-bookworm-slim AS deps
COPY --from=oven/bun:1.4.3-slim /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts

FROM ghcr.io/puppeteer/puppeteer:25.16.0@sha256:956a72e3d523c76606efaad23392fbe33950370189f749715222c7427f57392b AS renderer
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=9222 \
    BROWSER_RENDERER_WORK_DIR=/tmp/browser-renderer \
    BROWSER_RENDERER_CHROME=/home/pptruser/.cache/puppeteer/chrome-headless-shell/linux-156.0.8078.47/chrome-headless-shell-linux64/chrome-headless-shell
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
ENTRYPOINT []
CMD ["node", "src/server.mjs"]
