#!/usr/bin/with-contenv bashio

cd /app
exec bun run src/server.ts
