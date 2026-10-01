# 第一阶段：构建前端（React + MUI）
FROM node:22-alpine AS web
WORKDIR /app/web
# 下载前端依赖用的 npm 源，可在 .env 里用 NPM_REGISTRY 覆盖
ARG NPM_REGISTRY=https://registry.npmjs.org
COPY web/package.json web/package-lock.json ./
RUN npm ci --registry="$NPM_REGISTRY" --no-audit --no-fund
COPY web/ ./
RUN npm run build

# 第二阶段：面板后端（没有第三方依赖），同时提供构建好的前端
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080

COPY package.json server.js alice.js alice-time.js validate.js normalize.js store.js config.js scheduler.js telegram.js bot-views.js bot.js ./
COPY --from=web /app/public ./public

# 自动续期设置保存在 /data（docker-compose 里挂载为命名卷）；目录必须在切换到 node 用户之前创建并授权。
RUN mkdir -p /data && chown node:node /data
ENV DATA_DIR=/data

USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
  CMD wget -qO- "http://127.0.0.1:${PORT:-8080}/healthz" >/dev/null || exit 1

CMD ["node", "server.js"]
