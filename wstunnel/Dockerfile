FROM ghcr.io/home-assistant/base:latest

RUN apk add --no-cache curl ca-certificates unzip tzdata bash
RUN curl -fsSL https://bun.sh/install | bash
ENV BUN_INSTALL=/root/.bun
ENV PATH="$BUN_INSTALL/bin:${PATH}"

WORKDIR /app
COPY package.json tsconfig.json ./
COPY src ./src
COPY run.sh /run.sh
RUN chmod a+x /run.sh
RUN bun install

CMD ["/run.sh"]
