# 第一阶段：构建前端（Next.js + shadcn/ui，静态导出到 /app/web/out）
FROM node:22-alpine AS web
WORKDIR /app/web
# 下载前端依赖用的 npm 源，可在 .env 里用 NPM_REGISTRY 覆盖
ARG NPM_REGISTRY=https://registry.npmjs.org
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm install -g pnpm@12.8.1 --registry="$NPM_REGISTRY"
COPY web/package.json web/pnpm-lock.yaml web/pnpm-workspace.yaml ./
RUN pnpm config set registry "$NPM_REGISTRY" && pnpm install --frozen-lockfile
COPY web/ ./
# 构建时 next/font 会下载 Figtree / Geist Mono 字体并自托管（运行时不再访问 Google），所以构建机需要能访问 fonts.googleapis.com
RUN pnpm build

# 第二阶段：面板后端（没有第三方依赖），同时提供构建好的前端
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080

COPY package.json server.js alice.js alice-time.js validate.js normalize.js store.js config.js scheduler.js csp.js telegram.js bot-views.js bot.js ./
COPY --from=web /app/web/out ./public

# 自动续期设置保存在 /data（docker-compose 里挂载为命名卷）；目录必须在切换到 node 用户之前创建并授权。
RUN mkdir -p /data && chown node:node /data
ENV DATA_DIR=/data

USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
  CMD wget -qO- "http://127.0.0.1:${PORT:-8080}/healthz" >/dev/null || exit 1

CMD ["node", "server.js"]
