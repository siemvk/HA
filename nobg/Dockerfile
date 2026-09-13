FROM $BUILD_FROM

WORKDIR /app

COPY package.json pnpm-lock.yaml ./

RUN apk add --no-cache nodejs npm
RUN npm install -g pnpm

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm build

ENV HOST=0.0.0.0
ENV PORT=3000

EXPOSE 3000

CMD ["pnpm", "exec", "react-router-serve", "./build/server/index.js"]