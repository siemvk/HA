ARG BUILD_FROM
FROM $BUILD_FROM

# Add 'git' to the installed dependencies
RUN apk add --no-cache curl unzip bash libstdc++ git

# Install Bun globally
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

# Set the working directory
WORKDIR /app

# Clone your TypeScript application from GitHub into the /app directory
# Replace this URL with your actual repository URL!
RUN git clone https://github.com/your-username/your-typescript-app.git .

# Install dependencies using Bun directly after cloning
RUN bun install

# Copy the startup script (this file still lives next to your Dockerfile)
COPY run.sh /run.sh
RUN chmod a+x /run.sh

CMD [ "/run.sh" ]