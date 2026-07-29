#!/bin/sh
set -e

if [ -z "$DATABASE_URL" ]; then
  echo "WARNING: DATABASE_URL is not set. DB operations will fail."
else
  echo "Initialising database schema..."
  node /app/scripts/init-db.mjs
fi

echo "Starting Bybit Trading Bot API on port ${PORT:-3000}..."
exec node --enable-source-maps /app/artifacts/api-server/dist/index.mjs
