FROM node:22-slim

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

WORKDIR /app

COPY package.json tsconfig.json tsconfig.base.json ./
COPY artifacts/api-server ./artifacts/api-server
COPY lib/db               ./lib/db

COPY scripts/init-db.mjs ./scripts/init-db.mjs
COPY scripts/start.sh    ./scripts/start.sh
RUN chmod +x ./scripts/start.sh

RUN printf 'packages:\n  - "artifacts/api-server"\n  - "lib/db"\nautoInstallPeers: false\n' > pnpm-workspace.yaml

COPY docker-setup.js ./docker-setup.js
RUN node docker-setup.js && rm docker-setup.js

RUN pnpm install --no-frozen-lockfile --ignore-scripts
RUN pnpm --filter @workspace/api-server run build

EXPOSE 3000

CMD ["./scripts/start.sh"]
