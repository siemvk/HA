ARG BUILD_FROM
FROM $BUILD_FROM

# Install dependencies required for Bun and your app
RUN apk add --no-cache curl unzip bash libstdc++

# Install Bun globally
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

# Set the working directory inside the container
WORKDIR /app

# Copy package files first to leverage Docker caching
COPY package.json bun.lockb* ./
RUN bun install

# Copy the rest of your application code
COPY . .

# Copy and configure the startup script
COPY run.sh /run.sh
RUN chmod a+x /run.sh

CMD [ "/run.sh" ]