import { Router, type IRouter } from "express";
import { getBotState, startBot, stopBot } from "../lib/botRunner";
import { db } from "@workspace/db";
import { tradesTable, botSettingsTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/bot/status", async (req, res) => {
  const botState = getBotState();

  let openPositions = 0;
  let activeMarkets = 5;
  let reverseSignals = false;
  let dbReady = true;
  let dbError: string | null = null;

  try {
    const openTrades = await db.select().from(tradesTable);
    openPositions = openTrades.filter((t) => !t.exitDate).length;

    const settings = await db.select().from(botSettingsTable).limit(1);
    activeMarkets = settings[0]
      ? settings[0].enabledMarkets.split(",").filter(Boolean).length
      : 5;
    reverseSignals =
      (settings[0] as (typeof settings)[number] & { reverseSignals?: boolean } | undefined)
        ?.reverseSignals ?? false;
  } catch (err) {
    dbReady = false;
    dbError = err instanceof Error ? err.message : String(err);
    req.log.warn({ err: dbError }, "DB not ready — bot/status degraded response");
  }

  res.json({
    running:      botState.running,
    uptime:       botState.uptime,
    lastScan:     botState.lastScan,
    openPositions,
    activeMarkets,
    sessionValid: botState.sessionValid,
    error:        botState.error,
    reverseSignals,
    dbReady,
    dbError,
  });
});

router.post("/bot/start", async (req, res) => {
  try {
    await startBot();
    const botState = getBotState();
    res.json({
      running:      botState.running,
      uptime:       botState.uptime,
      lastScan:     botState.lastScan,
      openPositions: 0,
      activeMarkets: 5,
      sessionValid: botState.sessionValid,
      error:        botState.error,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to start bot");
    const msg = err instanceof Error ? err.message : "Failed to start bot";
    res.status(400).json({ error: msg });
  }
});

router.post("/bot/stop", async (req, res) => {
  try {
    await stopBot();
    const botState = getBotState();
    res.json({
      running:      botState.running,
      uptime:       botState.uptime,
      lastScan:     botState.lastScan,
      openPositions: 0,
      activeMarkets: 5,
      sessionValid: botState.sessionValid,
      error:        botState.error,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to stop bot");
    const msg = err instanceof Error ? err.message : "Failed to stop bot";
    res.status(400).json({ error: msg });
  }
});

export default router;
