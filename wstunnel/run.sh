#!/usr/bin/with-contenv bashio

if bashio::config.has_value 'protect_level'; then
  export PROTECT_LEVEL="$(bashio::config 'protect_level')"
fi
if bashio::config.has_value 'secret'; then
  export SECRET="$(bashio::config 'secret')"
fi
if bashio::config.has_value 'subdomain_domains'; then
  export SUBDOMAIN_DOMAINS="$(bashio::config 'subdomain_domains')"
fi

cd /app
exec bun run src/index.ts
