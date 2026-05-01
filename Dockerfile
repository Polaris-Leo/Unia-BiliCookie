# ---- 构建阶段 ----
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# ---- 运行阶段 ----
FROM node:20-alpine
WORKDIR /app

# 创建非 root 用户，提升安全性
RUN addgroup -S appgroup && adduser -S appuser -G appgroup && \
    apk add --no-cache su-exec

# 只拷贝必要文件
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY server.js ./
COPY routes/ ./routes/
COPY services/ ./services/
COPY utils/ ./utils/
COPY public/ ./public/
COPY entrypoint.sh ./entrypoint.sh

# data 目录挂载为 volume，此处预先建好并授权
RUN mkdir -p /app/data && chown -R appuser:appgroup /app && \
    chmod +x /app/entrypoint.sh

ENV NODE_ENV=production \
    PORT=3100

EXPOSE 3100

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3100/api/health || exit 1

# entrypoint 以 root 启动，修复 bind mount 权限后降权到 appuser 运行
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "server.js"]
