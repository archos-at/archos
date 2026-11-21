FROM oven/bun:1.4.4-slim@sha256:1846adf22496bd711036aae8be147e57bdebbaea2e5264e3e0b5af1db187d9a4 AS bun

FROM node:22.23.5-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS deps
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
COPY --from=deps /app/node_modules/@expo-google-fonts/hanken-grotesk/LICENSE_FONT ./node_modules/@expo-google-fonts/hanken-grotesk/
COPY --from=deps /app/node_modules/@expo-google-fonts/hanken-grotesk/400Regular ./node_modules/@expo-google-fonts/hanken-grotesk/400Regular
COPY --from=deps /app/node_modules/@expo-google-fonts/hanken-grotesk/400Regular_Italic ./node_modules/@expo-google-fonts/hanken-grotesk/400Regular_Italic
COPY --from=deps /app/node_modules/@expo-google-fonts/hanken-grotesk/500Medium ./node_modules/@expo-google-fonts/hanken-grotesk/500Medium
COPY --from=deps /app/node_modules/@expo-google-fonts/hanken-grotesk/500Medium_Italic ./node_modules/@expo-google-fonts/hanken-grotesk/500Medium_Italic
COPY --from=deps /app/node_modules/@expo-google-fonts/hanken-grotesk/600SemiBold ./node_modules/@expo-google-fonts/hanken-grotesk/600SemiBold
COPY --from=deps /app/node_modules/@expo-google-fonts/hanken-grotesk/600SemiBold_Italic ./node_modules/@expo-google-fonts/hanken-grotesk/600SemiBold_Italic
COPY package.json ./
COPY src ./src
USER pptruser
EXPOSE 9222
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "src/server.mjs"]
