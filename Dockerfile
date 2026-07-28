FROM node:22-slim

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

WORKDIR /app

# ── Root workspace config ────────────────────────────────────────────────────
COPY package.json tsconfig.json tsconfig.base.json ./

# ── Application packages ─────────────────────────────────────────────────────
COPY artifacts/api-server ./artifacts/api-server
COPY lib/db               ./lib/db

# ── Startup helper ───────────────────────────────────────────────────────────
COPY docker-setup.js ./docker-setup.js
COPY scripts/start.sh ./start.sh
RUN chmod +x ./start.sh

# ── Write a minimal pnpm-workspace.yaml (only packages in this build) ────────
RUN printf 'packages:\n  - "artifacts/api-server"\n  - "lib/db"\nautoInstallPeers: false\n' > pnpm-workspace.yaml

# ── Resolve "catalog:" references and strip workspace-only fields ─────────────
RUN node docker-setup.js && rm docker-setup.js

# ── Install dependencies ──────────────────────────────────────────────────────
RUN pnpm install --no-frozen-lockfile --ignore-scripts

# ── Build API server (esbuild bundle) ────────────────────────────────────────
RUN pnpm --filter @workspace/api-server run build

# ── Railway injects PORT automatically ───────────────────────────────────────
EXPOSE 3000

# start.sh: push DB schema then start the server
CMD ["./start.sh"]
