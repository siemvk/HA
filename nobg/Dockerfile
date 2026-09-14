# 1. Install all dependencies (for build)
FROM node:22-slim AS development-dependencies-env
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# 2. Install production-only dependencies
FROM node:22-slim AS production-dependencies-env
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

# 3. Build the application
FROM node:22-slim AS build-env
WORKDIR /app
RUN corepack enable
COPY . .
COPY --from=development-dependencies-env /app/node_modules /app/node_modules
RUN pnpm run build

# 4. Final runtime image
FROM node:22-slim
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --from=production-dependencies-env /app/node_modules /app/node_modules
COPY --from=build-env /app/build /app/build

ENV HOST=0.0.0.0
ENV PORT=3000
EXPOSE 3000

CMD ["pnpm", "exec", "react-router-serve", "./build/server/index.js"]