# LocalClaude in server mode: the app without a window, served to a browser (see docs/self-hosting.md).
# It runs the same main process as the desktop app, under Electron with no display.

# ---- build: compile the app
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# ---- runtime dependencies: production packages plus Electron (the runtime it runs on)
FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
 && npm install --no-save --no-audit --no-fund "electron@$(node -p "require('./package-lock.json').packages['node_modules/electron'].version")" \
 && node node_modules/electron/install.js \
 && npm cache clean --force

# ---- the image
FROM node:24-bookworm-slim
# Chromium's libraries (Electron needs them even without a display), plus tools Claude uses on your code
RUN apt-get update && apt-get install -y --no-install-recommends \
      libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libgtk-3-0 libgbm1 libasound2 \
      libxss1 libxshmfence1 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libx11-xcb1 \
      libpango-1.0-0 libcairo2 fonts-liberation fonts-noto-color-emoji \
      ca-certificates git openssh-client curl ripgrep python3 tini \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/out ./out
COPY package.json ./
COPY docker/entrypoint.sh /usr/local/bin/localclaude-entrypoint
RUN chmod 755 /usr/local/bin/localclaude-entrypoint \
 && mkdir -p /data /workspace && chown node:node /data /workspace

ENV LOCALCLAUDE_SERVER=1 \
    LOCALCLAUDE_HOST=0.0.0.0 \
    LOCALCLAUDE_PORT=8080 \
    LOCALCLAUDE_DATA=/data \
    LOCALCLAUDE_WORKSPACE=/workspace \
    HOME=/data/home \
    CLAUDE_CONFIG_DIR=/data/home/.claude \
    NODE_ENV=production

# runs as the image's unprivileged "node" user (uid 1000) unless compose says otherwise
USER node
VOLUME ["/data", "/workspace"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["/usr/bin/tini", "--", "localclaude-entrypoint"]
