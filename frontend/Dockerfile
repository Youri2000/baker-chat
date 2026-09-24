# 前端镜像（由 docker-compose.yml 以仓库根为上下文构建，因为 pnpm-lock.yaml 与 workspace 配置在根目录）：
# 第一阶段 node:22-alpine 按锁文件安装 frontend 的依赖并 vite build，VITE_API_BASE_URL 在构建期写进产物；
# 第二阶段 nginx:alpine 只托管 dist，nginx.conf 负责 SPA 回退。
FROM node:22-alpine AS build

ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

WORKDIR /app
# corepack 按根 package.json 的 packageManager 字段取 pnpm 9.12.0，与本地同版本
RUN corepack enable

# 先只复制安装所需文件，源码变化不会让依赖层失效；--ignore-scripts 跳过根目录的 husky prepare（镜像里没有 .git）
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY frontend/package.json ./frontend/
RUN pnpm install --frozen-lockfile --filter frontend --ignore-scripts

COPY frontend ./frontend
RUN pnpm --filter frontend build

FROM nginx:alpine

COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
