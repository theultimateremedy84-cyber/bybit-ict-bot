import express, { type Express } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url?.split("?")[0] };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// All API routes live under /api
app.use("/api", router);

// ── Serve the React frontend ──────────────────────────────────────────────────
// In production (Railway) the Dockerfile copies the Vite build output into
// artifacts/api-server/dist/public/ before the runner stage starts.
// __dirname here resolves to the dist/ folder at runtime, so ../public is
// dist/public/ — exactly where we put it.
const publicDir = path.resolve(__dirname, "../public");
app.use(express.static(publicDir));

// SPA fallback — any route that isn't /api/* and has no static file gets
// index.html so React Router can handle client-side navigation.
app.get("/{*splat}", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

export default app;
