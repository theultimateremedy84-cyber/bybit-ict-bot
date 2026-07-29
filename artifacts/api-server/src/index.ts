import app from "./app";
import { logger } from "./lib/logger";
import { startBot } from "./lib/botRunner";
import { ensureDb } from "./lib/ensureDb";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not set.");
}

const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// ── Initialise DB schema before accepting any requests ────────────────────────
// This is intentionally called before app.listen so that tables always exist
// by the time the first HTTP request arrives. It is safe to call on every
// boot — all statements use CREATE TABLE IF NOT EXISTS.
//
// Doing this in-process (rather than relying solely on scripts/init-db.mjs)
// makes the deployment resilient to Railway's environment-variable injection
// timing and to any failure in the pre-start shell script.
await ensureDb();

app.listen(port, async () => {
  logger.info({ port }, "Server listening");

  // Auto-start the bot if credentials are present as environment variables.
  // This enables a zero-click startup on Railway when BYBIT_API_KEY and
  // BYBIT_API_SECRET are set in the deployment environment.
  const autoStart =
    process.env["AUTO_START_BOT"] === "true" ||
    (process.env["BYBIT_API_KEY"] && process.env["BYBIT_API_SECRET"]);

  if (autoStart) {
    logger.info("Auto-starting trading bot (credentials detected)…");
    try {
      await startBot();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(
        { err: msg },
        "Auto-start failed — bot will need to be started manually via /api/bot/start"
      );
    }
  } else {
    logger.info(
      "Bot not auto-started. Set BYBIT_API_KEY + BYBIT_API_SECRET (+ optionally AUTO_START_BOT=true) to enable auto-start, or POST /api/bot/start."
    );
  }
});
