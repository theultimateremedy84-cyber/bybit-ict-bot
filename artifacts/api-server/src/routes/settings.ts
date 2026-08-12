import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { botSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

function serializeSettings(s: typeof botSettingsTable.$inferSelect) {
  return {
    id: s.id,
    riskPerTrade:       s.riskPerTrade,
    maxOpenTrades:      s.maxOpenTrades,
    dailyLossLimit:     s.dailyLossLimit,
    enabledMarkets:     s.enabledMarkets.split(",").map((m: string) => m.trim()).filter(Boolean),
    enabledKillZones:   s.enabledKillZones.split(",").map((k: string) => k.trim()).filter(Boolean),
    minConfidence:      s.minConfidence,
    useOrderBlocks:     s.useOrderBlocks,
    useFairValueGaps:   s.useFairValueGaps,
    useLiquiditySweeps: s.useLiquiditySweeps,
    useBOS:             s.useBOS,
    useChoCH:           s.useChoCH,
    trailingStop:       s.trailingStop,
    minRR:              s.minRR,
    // Institutional order-flow layer
    useOrderFlow:            s.useOrderFlow,
    orderFlowVetoThreshold:  s.orderFlowVetoThreshold,
    requireFlowConfirmation: s.requireFlowConfirmation,
    minFlowConfirmation:     s.minFlowConfirmation,
    cryptoMode:              s.cryptoMode,
    maxRelativeSpread:       s.maxRelativeSpread,
    // Institutional risk layer
    maxLeverage:             s.maxLeverage,
    scaleByConfidence:       s.scaleByConfidence,
    maxPerCorrelationGroup:  s.maxPerCorrelationGroup,
    maxDirectionalLeverage:  s.maxDirectionalLeverage,
    maxTotalLeverage:        s.maxTotalLeverage,
    breakEvenAtR:            s.breakEvenAtR,
    trailAtR:                s.trailAtR,
    trailAtrMultiple:        s.trailAtrMultiple,
    // Execution mode
    reverseSignals:          (s as typeof s & { reverseSignals?: boolean }).reverseSignals ?? false,
    // Never send the actual secret back — only confirm it is set
    bybitApiKey:    s.bybitApiKey    ? "***" : "",
    bybitApiSecret: s.bybitApiSecret ? "***" : "",
    bybitTestnet:   s.bybitTestnet,
    // true → Demo Trading (api-demo.bybit.com) — keys created on bybit.com under Demo Account
    // false + bybitTestnet=true → Testnet (api-testnet.bybit.com) — keys from testnet.bybit.com
    bybitDemo:      (s as typeof s & { bybitDemo?: boolean }).bybitDemo ?? false,
  };
}

router.get("/settings", async (req, res) => {
  try {
    let rows = await db.select().from(botSettingsTable).limit(1);
    if (rows.length === 0) {
      const inserted = await db.insert(botSettingsTable).values({}).returning();
      rows = inserted;
    }
    const row = rows[0];
    // Overlay env vars so UI reflects what the bot actually uses
    const effective = {
      ...row,
      bybitApiKey:    process.env["BYBIT_API_KEY"]    || row.bybitApiKey,
      bybitApiSecret: process.env["BYBIT_API_SECRET"] || row.bybitApiSecret,
      bybitTestnet:
        process.env["BYBIT_TESTNET"] !== undefined
          ? process.env["BYBIT_TESTNET"] === "true"
          : row.bybitTestnet,
      bybitDemo:
        process.env["BYBIT_DEMO"] !== undefined
          ? process.env["BYBIT_DEMO"] === "true"
          : (row as typeof row & { bybitDemo?: boolean }).bybitDemo ?? false,
    };
    res.json(serializeSettings(effective));
  } catch (err) {
    req.log.error({ err }, "Failed to get settings");
    res.status(500).json({ error: "Failed to get settings" });
  }
});

const updateSettings = async (req: Request, res: Response) => {
  try {
    const body = req.body as {
      riskPerTrade?:       number;
      maxOpenTrades?:      number;
      dailyLossLimit?:     number;
      enabledMarkets?:     string[];
      enabledKillZones?:   string[];
      minConfidence?:      number;
      useOrderBlocks?:     boolean;
      useFairValueGaps?:   boolean;
      useLiquiditySweeps?: boolean;
      useBOS?:             boolean;
      useChoCH?:           boolean;
      trailingStop?:       boolean;
      minRR?:              number;
      useOrderFlow?:            boolean;
      orderFlowVetoThreshold?:  number;
      requireFlowConfirmation?: boolean;
      minFlowConfirmation?:     number;
      cryptoMode?:              boolean;
      maxRelativeSpread?:       number;
      maxLeverage?:             number;
      scaleByConfidence?:       boolean;
      maxPerCorrelationGroup?:  number;
      maxDirectionalLeverage?:  number;
      maxTotalLeverage?:        number;
      breakEvenAtR?:            number;
      trailAtR?:                number;
      trailAtrMultiple?:        number;
      reverseSignals?:          boolean;
      bybitApiKey?:        string;
      bybitApiSecret?:     string;
      bybitTestnet?:       boolean;
      bybitDemo?:          boolean;
    };

    const updateData: Partial<typeof botSettingsTable.$inferInsert> = {};

    if (body.riskPerTrade       !== undefined) updateData.riskPerTrade       = body.riskPerTrade;
    if (body.maxOpenTrades      !== undefined) updateData.maxOpenTrades      = body.maxOpenTrades;
    if (body.dailyLossLimit     !== undefined) updateData.dailyLossLimit     = body.dailyLossLimit;
    if (body.enabledMarkets     !== undefined) updateData.enabledMarkets     = body.enabledMarkets.join(",");
    if (body.enabledKillZones   !== undefined) updateData.enabledKillZones   = body.enabledKillZones.join(",");
    if (body.minConfidence      !== undefined) {
      // Stored on a 0-100 scale. Accept legacy 0-1 fractions and clamp.
      const raw = Number(body.minConfidence);
      const scaled = raw > 0 && raw <= 1 ? raw * 100 : raw;
      updateData.minConfidence = Math.min(100, Math.max(0, scaled));
    }
    if (body.useOrderBlocks     !== undefined) updateData.useOrderBlocks     = body.useOrderBlocks;
    if (body.useFairValueGaps   !== undefined) updateData.useFairValueGaps   = body.useFairValueGaps;
    if (body.useLiquiditySweeps !== undefined) updateData.useLiquiditySweeps = body.useLiquiditySweeps;
    if (body.useBOS             !== undefined) updateData.useBOS             = body.useBOS;
    if (body.useChoCH           !== undefined) updateData.useChoCH           = body.useChoCH;
    if (body.trailingStop       !== undefined) updateData.trailingStop       = body.trailingStop;
    if (body.minRR              !== undefined) updateData.minRR              = body.minRR;
    if (body.useOrderFlow            !== undefined) updateData.useOrderFlow            = body.useOrderFlow;
    if (body.orderFlowVetoThreshold  !== undefined) updateData.orderFlowVetoThreshold  = body.orderFlowVetoThreshold;
    if (body.requireFlowConfirmation !== undefined) updateData.requireFlowConfirmation = body.requireFlowConfirmation;
    if (body.minFlowConfirmation     !== undefined) updateData.minFlowConfirmation     = body.minFlowConfirmation;
    if (body.cryptoMode              !== undefined) updateData.cryptoMode              = body.cryptoMode;
    if (body.maxRelativeSpread       !== undefined) updateData.maxRelativeSpread       = body.maxRelativeSpread;
    if (body.maxLeverage             !== undefined) updateData.maxLeverage             = body.maxLeverage;
    if (body.scaleByConfidence       !== undefined) updateData.scaleByConfidence       = body.scaleByConfidence;
    if (body.maxPerCorrelationGroup  !== undefined) updateData.maxPerCorrelationGroup  = body.maxPerCorrelationGroup;
    if (body.maxDirectionalLeverage  !== undefined) updateData.maxDirectionalLeverage  = body.maxDirectionalLeverage;
    if (body.maxTotalLeverage        !== undefined) updateData.maxTotalLeverage        = body.maxTotalLeverage;
    if (body.breakEvenAtR            !== undefined) updateData.breakEvenAtR            = body.breakEvenAtR;
    if (body.trailAtR                !== undefined) updateData.trailAtR                = body.trailAtR;
    if (body.trailAtrMultiple        !== undefined) updateData.trailAtrMultiple        = body.trailAtrMultiple;
    if (body.reverseSignals !== undefined) {
      // Accept only an actual boolean. This prevents truthy strings such as
      // "false" from being written as enabled by non-generated clients.
      if (typeof body.reverseSignals !== "boolean") {
        res.status(400).json({ error: "reverseSignals must be true or false" });
        return;
      }
      updateData.reverseSignals = body.reverseSignals;
    }
    if (body.bybitTestnet !== undefined) updateData.bybitTestnet = body.bybitTestnet;
    if (body.bybitDemo    !== undefined) (updateData as typeof updateData & { bybitDemo?: boolean }).bybitDemo = body.bybitDemo;

    // Only update secrets when a real (unmasked) value is provided
    if (body.bybitApiKey    && body.bybitApiKey    !== "***") updateData.bybitApiKey    = body.bybitApiKey;
    if (body.bybitApiSecret && body.bybitApiSecret !== "***") updateData.bybitApiSecret = body.bybitApiSecret;

    updateData.updatedAt = new Date();

    let rows = await db.select().from(botSettingsTable).limit(1);
    let updated;
    if (rows.length === 0) {
      const inserted = await db.insert(botSettingsTable).values(updateData).returning();
      updated = inserted[0];
    } else {
      const result = await db
        .update(botSettingsTable)
        .set(updateData)
        .where(eq(botSettingsTable.id, rows[0].id))
        .returning();
      updated = result[0];
    }

    if (!updated) {
      throw new Error("Settings update did not return a persisted row");
    }

    // Return the value read back from Postgres rather than trusting the input.
    // The dashboard can therefore detect a failed/non-persistent toggle instead
    // of displaying a success toast and silently switching it back off later.
    const persistedRows = await db
      .select()
      .from(botSettingsTable)
      .where(eq(botSettingsTable.id, updated.id))
      .limit(1);
    const persisted = persistedRows[0];
    if (!persisted) {
      throw new Error("Saved settings could not be read back");
    }

    req.log.info(
      { reverseSignals: persisted.reverseSignals },
      "Settings saved and verified"
    );
    res.json(serializeSettings(persisted));
  } catch (err) {
    req.log.error({ err }, "Failed to update settings");
    res.status(400).json({ error: "Failed to update settings" });
  }
};

// Keep both methods supported. The generated dashboard client historically used
// PATCH while older integrations and the README use PUT.
router.put("/settings", updateSettings);
router.patch("/settings", updateSettings);

export default router;
