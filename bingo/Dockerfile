ARG BUILD_FROM
FROM $BUILD_FROM

# Install dependencies required for Bun (no git needed anymore)
RUN apk add --no-cache curl unzip bash libstdc++

# Install Bun globally
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

# Set the working directory inside the container
WORKDIR /app

# Copy the contents of your local 'code' folder into the /app directory
COPY code/ ./

# Install the dependencies from the package.json we just copied
RUN bun install

# Copy the startup script from the root of the Add-on folder
COPY run.sh /run.sh
RUN chmod a+x /run.sh

CMD [ "/run.sh" ]