import app from "./app";
import { logger } from "./lib/logger";
import { startBot } from "./lib/botRunner";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not set.");
}

const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

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
      logger.error({ err: msg }, "Auto-start failed — bot will need to be started manually via /api/bot/start");
    }
  } else {
    logger.info(
      "Bot not auto-started. Set BYBIT_API_KEY + BYBIT_API_SECRET (+ optionally AUTO_START_BOT=true) to enable auto-start, or POST /api/bot/start."
    );
  }
});
