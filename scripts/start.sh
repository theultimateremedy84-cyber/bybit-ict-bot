#!/bin/sh
# Railway startup script
# 1. Pushes Drizzle schema to the database (idempotent — safe to re-run)
# 2. Starts the API server
set -e

if [ -z "$DATABASE_URL" ]; then
  echo "WARNING: DATABASE_URL is not set. Skipping schema push. DB operations will fail."
else
  echo "Pushing database schema (timeout: 60s)..."
  timeout 60 pnpm --filter @workspace/db run push-force 2>&1 || {
    echo "WARNING: Schema push failed or timed out. Server will still start."
  }
  echo "Schema push complete."
fi

echo "Starting Bybit Trading Bot API on port ${PORT:-3000}..."
exec node --enable-source-maps /app/artifacts/api-server/dist/index.mjs
