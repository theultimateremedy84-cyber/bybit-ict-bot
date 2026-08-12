# ============================================================
# Bybit ICT Bot — Fixed Dockerfile
# ============================================================

FROM node:22-slim AS builder

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

WORKDIR /app

# Root workspace files
COPY package.json tsconfig.json tsconfig.base.json ./

# Backend + dashboard (dashboard lives inside artifacts/api-server/dashboard/)
COPY artifacts/api-server ./artifacts/api-server
COPY lib/db               ./lib/db

# Scripts
COPY scripts/init-db.mjs ./scripts/init-db.mjs
COPY scripts/start.sh    ./scripts/start.sh
RUN chmod +x ./scripts/start.sh

# Resolve catalog: version placeholders, then install
COPY docker-setup.js ./docker-setup.js
RUN node docker-setup.js && rm docker-setup.js

# Inline workspace — dashboard is nested inside artifacts/api-server/dashboard
RUN printf 'packages:\n  - "artifacts/api-server"\n  - "artifacts/api-server/dashboard"\n  - "lib/db"\nautoInstallPeers: false\n' > pnpm-workspace.yaml

RUN pnpm install --no-frozen-lockfile --ignore-scripts

# 1. Build the React dashboard  →  artifacts/api-server/dashboard/dist/public/
RUN pnpm --filter @workspace/dashboard run build

# 2. Build the Express API bundle  →  artifacts/api-server/dist/
RUN pnpm --filter @workspace/api-server run build

# 3. Copy React build into dist/public/ so Express can serve it
RUN cp -r artifacts/api-server/dashboard/dist/public/. artifacts/api-server/dist/public/

# ── Runner stage ──────────────────────────────────────────────────────────────
FROM node:22-slim AS runner

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

WORKDIR /app

COPY package.json tsconfig.json tsconfig.base.json ./
COPY --from=builder /app/artifacts/api-server/package.json ./artifacts/api-server/package.json
COPY --from=builder /app/artifacts/api-server/dist         ./artifacts/api-server/dist
COPY --from=builder /app/lib/db/package.json               ./lib/db/package.json
COPY --from=builder /app/lib/db/src                        ./lib/db/src

COPY scripts/init-db.mjs ./scripts/init-db.mjs
COPY scripts/start.sh    ./scripts/start.sh
RUN chmod +x ./scripts/start.sh

COPY docker-setup.js ./docker-setup.js
RUN printf 'packages:\n  - "artifacts/api-server"\n  - "lib/db"\nautoInstallPeers: false\n' > pnpm-workspace.yaml
RUN node docker-setup.js && rm docker-setup.js

RUN pnpm install --no-frozen-lockfile --ignore-scripts --prod

EXPOSE 3000

CMD ["./scripts/start.sh"]
