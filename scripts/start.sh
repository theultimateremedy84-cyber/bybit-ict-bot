#!/bin/sh
# start.sh — entrypoint for the Railway / Docker deployment
#
# DB schema is also initialised IN-PROCESS (src/lib/ensureDb.ts) before
# app.listen, so this script is a best-effort warm-up only.  A failure here
# must NOT prevent the server from starting.

if [ -z "$DATABASE_URL" ]; then
  echo "WARNING: DATABASE_URL is not set. The server will start but all DB" \
       "routes will fail. Set DATABASE_URL in your Railway Variables tab."
else
  echo "Initialising database schema (pre-start)..."
  # Run init-db.mjs but do NOT let a failure abort the container startup.
  # The server performs its own ensureDb() on boot which is the authoritative
  # schema init path.
  node /app/scripts/init-db.mjs || echo "WARNING: init-db.mjs exited with errors — server will attempt in-process DB init on boot."
fi

echo "Starting Bybit Trading Bot API on port ${PORT:-3000}..."
exec node --enable-source-maps /app/artifacts/api-server/dist/index.mjs
