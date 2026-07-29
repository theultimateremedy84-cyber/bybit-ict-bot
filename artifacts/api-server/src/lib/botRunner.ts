/**
 * Bot Runner — Main trading bot loop (Bybit Edition)
 *
 * Orchestrates:
 * 1. Bybit API client (HMAC-SHA256, no session tokens)
 * 2. Market scanning on schedule
 * 3. ICT signal detection (multi-timeframe)
 * 4. Trade execution on Bybit USDT Perpetuals
 * 5. Position monitoring / trade closing detection
 */

import { db } from "@workspace/db";
import { signalsTable, tradesTable, botSettingsTable } from "@workspace/db";
import { eq, desc, isNull } from "drizzle-orm";
import { BybitApiClient, type BybitCandle } from "./bybitApi";
import { analyzeMarket, getCurrentKillZone } from "./ictStrategy";
import {
  calculatePositionSize,
  canOpenNewTrade,
  formatPrice,
  getMinSizeForSymbol,
  getMaxSizeForSymbol,
  getDecimalPlacesForSymbol,
  getMinStopDistance,
} from "./riskManager";
import { logger } from "./logger";

// ─────────────────────────────────────────────
// Candle aggregation helpers
// Bybit supports D / W / M intervals natively,
// but we derive weekly/monthly from daily for consistency.
// ─────────────────────────────────────────────

function mergeGroup(candles: BybitCandle[]): BybitCandle {
  return {
    snapshotTime: candles[0].snapshotTime,
    openPrice: candles[0].openPrice,
    highPrice: {
      bid: Math.max(...candles.map((c) => c.highPrice.bid)),
      ask: Math.max(...candles.map((c) => c.highPrice.ask)),
    },
    lowPrice: {
      bid: Math.min(...candles.map((c) => c.lowPrice.bid)),
      ask: Math.min(...candles.map((c) => c.lowPrice.ask)),
    },
    closePrice: candles[candles.length - 1].closePrice,
    lastTradedVolume: candles.reduce((s, c) => s + c.lastTradedVolume, 0),
  };
}

function toWeeklyCandles(daily: BybitCandle[]): BybitCandle[] {
  if (daily.length === 0) return [];
  const groups: BybitCandle[][] = [];
  let current: BybitCandle[] = [];
  for (const candle of daily) {
    const dayOfWeek = new Date(candle.snapshotTime).getUTCDay();
    if (dayOfWeek === 1 && current.length > 0) {
      groups.push(current);
      current = [];
    }
    current.push(candle);
  }
  if (current.length > 0) groups.push(current);
  return groups.map(mergeGroup);
}

function toMonthlyCandles(daily: BybitCandle[]): BybitCandle[] {
  if (daily.length === 0) return [];
  const groups: BybitCandle[][] = [];
  let current: BybitCandle[] = [];
  let currentMonth = -1;
  for (const candle of daily) {
    const month = new Date(candle.snapshotTime).getUTCMonth();
    if (month !== currentMonth && current.length > 0) {
      groups.push(current);
      current = [];
    }
    currentMonth = month;
    current.push(candle);
  }
  if (current.length > 0) groups.push(current);
  return groups.map(mergeGroup);
}

// ─────────────────────────────────────────────
// Market map
// ─────────────────────────────────────────────

const MARKET_MAP: Record<string, string> = {
  BTCUSDT:  "Bitcoin",
  ETHUSDT:  "Ethereum",
  SOLUSDT:  "Solana",
  BNBUSDT:  "BNB",
  XRPUSDT:  "Ripple",
  ADAUSDT:  "Cardano",
  DOGEUSDT: "Dogecoin",
  LTCUSDT:  "Litecoin",
  LINKUSDT: "Chainlink",
  AVAXUSDT: "Avalanche",
  DOTUSDT:  "Polkadot",
  MATICUSDT:"Polygon",
};

// ─────────────────────────────────────────────
// Bot state
// ─────────────────────────────────────────────

interface BotState {
  running: boolean;
  startedAt: Date | null;
  lastScan: Date | null;
  error: string | null;
  client: BybitApiClient | null;
  scanInterval: NodeJS.Timeout | null;
  sessionValid: boolean;
}

const state: BotState = {
  running: false,
  startedAt: null,
  lastScan: null,
  error: null,
  client: null,
  scanInterval: null,
  sessionValid: false,
};

export function getBotState() {
  return {
    running: state.running,
    uptime: state.startedAt
      ? Math.floor((Date.now() - state.startedAt.getTime()) / 1000)
      : null,
    lastScan: state.lastScan?.toISOString() ?? null,
    error: state.error,
    sessionValid: state.sessionValid,
  };
}

// ─────────────────────────────────────────────
// Settings loader
// ─────────────────────────────────────────────

async function loadSettings() {
  const rows = await db.select().from(botSettingsTable).limit(1);
  let row: typeof botSettingsTable.$inferSelect;
  if (rows.length === 0) {
    const inserted = await db.insert(botSettingsTable).values({}).returning();
    row = inserted[0];
  } else {
    row = rows[0];
  }

  // Env vars override DB so deployments work without a Settings page visit
  return {
    ...row,
    bybitApiKey:    process.env["BYBIT_API_KEY"]    || row.bybitApiKey,
    bybitApiSecret: process.env["BYBIT_API_SECRET"] || row.bybitApiSecret,
    bybitTestnet:
      process.env["BYBIT_TESTNET"] !== undefined
        ? process.env["BYBIT_TESTNET"] === "true"
        : row.bybitTestnet,
    // BYBIT_DEMO=true → use api-demo.bybit.com (Demo Trading account keys)
    // This is different from BYBIT_TESTNET which uses api-testnet.bybit.com
    bybitDemo:
      process.env["BYBIT_DEMO"] !== undefined
        ? process.env["BYBIT_DEMO"] === "true"
        : (row as typeof row & { bybitDemo?: boolean }).bybitDemo ?? false,
  };
}

// ─────────────────────────────────────────────
// Market scanner
// ─────────────────────────────────────────────

async function scanMarkets() {
  if (!state.client) return;

  // Validate credentials are still live before a full scan
  state.sessionValid = await state.client.isSessionValid();
  if (!state.sessionValid) {
    logger.error("Bybit credential check failed — check BYBIT_API_KEY / BYBIT_API_SECRET");
    return;
  }

  const scanStart = new Date().toISOString();
  logger.info({ scanStart }, "=== Market scan starting ===");

  try {
    const settings = await loadSettings();
    const symbols = settings.enabledMarkets
      .split(",")
      .map((s: string) => s.trim())
      .filter(Boolean);
    const enabledKillZones = settings.enabledKillZones
      .split(",")
      .map((k: string) => k.trim())
      .filter(Boolean);

    const currentKillZone = getCurrentKillZone();
    logger.info(
      {
        currentKillZone,
        enabledKillZones,
        inKillZone: currentKillZone !== null && enabledKillZones.includes(currentKillZone),
      },
      "Kill zone check"
    );

    // Fetch wallet balance
    const wallet = await state.client.getWalletBalance();
    if (!wallet) {
      logger.error("Could not fetch Bybit wallet balance — check credentials");
      return;
    }

    const balance = wallet.totalWalletBalance;
    logger.info(
      {
        totalWallet: balance,
        available: wallet.totalAvailableBalance,
        unrealisedPnl: wallet.totalUnrealisedPnl,
      },
      "Wallet snapshot"
    );

    // Fetch open positions on Bybit
    const bybitPositions = await state.client.getPositions();
    const openCount = bybitPositions.length;

    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);

    const tradesRows = await db
      .select()
      .from(tradesTable)
      .orderBy(desc(tradesTable.entryDate))
      .limit(100);

    const todayPnl = tradesRows
      .filter(
        (t) =>
          t.exitDate &&
          new Date(t.exitDate) >= todayStart &&
          t.profit !== null
      )
      .reduce((sum, t) => sum + (t.profit ?? 0), 0);

    const dailyRiskCheck = canOpenNewTrade(openCount, settings.maxOpenTrades, {
      tradesToday: tradesRows.filter(
        (t) => t.exitDate && new Date(t.exitDate) >= todayStart
      ).length,
      pnlToday: todayPnl,
      dailyLossLimit: settings.dailyLossLimit,
      accountBalance: balance,
    });

    if (!dailyRiskCheck.allowed) {
      logger.info(
        { reason: dailyRiskCheck.reason },
        "Daily risk limit — no new trades will be opened this scan"
      );
    }

    const strategyConfig = {
      useOrderBlocks:     settings.useOrderBlocks,
      useFairValueGaps:   settings.useFairValueGaps,
      useLiquiditySweeps: settings.useLiquiditySweeps,
      useBOS:             settings.useBOS,
      useChoCH:           settings.useChoCH,
      minRR:              settings.minRR,
      minConfidence:      settings.minConfidence,
      enabledKillZones,
    };

    logger.info(
      {
        symbols,
        minConfidence: settings.minConfidence,
        minRR: settings.minRR,
        strategyFeatures: strategyConfig,
      },
      "Scanning markets"
    );

    for (const symbol of symbols) {
      try {
        logger.info({ symbol }, "Fetching candle data…");

        const [dailyCandles, h4Candles, h1Candles, m15Candles, ticker] =
          await Promise.all([
            state.client.getCandles(symbol, "D",   200),  // ~9 months for monthly/weekly derivation
            state.client.getCandles(symbol, "240",  50),  // 4h
            state.client.getCandles(symbol, "60",  100),  // 1h
            state.client.getCandles(symbol, "15",  100),  // 15m
            state.client.getTicker(symbol),
          ]);

        const weeklyCandles  = toWeeklyCandles(dailyCandles);
        const monthlyCandles = toMonthlyCandles(dailyCandles);

        if (!ticker) {
          logger.warn({ symbol }, "Ticker not found — skipping");
          continue;
        }

        logger.info(
          {
            symbol,
            lastPrice: ticker.lastPrice,
            daily: dailyCandles.length,
            weekly: weeklyCandles.length,
            monthly: monthlyCandles.length,
            h4: h4Candles.length,
            h1: h1Candles.length,
            m15: m15Candles.length,
          },
          "Candle data fetched — running ICT analysis"
        );

        const signal = await analyzeMarket(
          symbol,
          MARKET_MAP[symbol] ?? symbol,
          monthlyCandles,
          weeklyCandles,
          dailyCandles,
          h4Candles,
          h1Candles,
          m15Candles,
          ticker.bid1Price,
          ticker.ask1Price,
          strategyConfig
        );

        if (!signal) {
          logger.info(
            { symbol, minConfidence: settings.minConfidence, minRR: settings.minRR },
            "No signal — HTF alignment missing, confidence below threshold, or no entry confluence."
          );
          continue;
        }

        logger.info(
          {
            symbol,
            signal: signal.signalType,
            direction: signal.direction,
            confidence: signal.confidence,
            htfBias: signal.htfBias,
            killZone: signal.killZone,
            entry: signal.entryPrice,
            stop: signal.stopLoss,
            target: signal.takeProfit,
          },
          "ICT signal detected"
        );

        const [savedSignal] = await db
          .insert(signalsTable)
          .values({
            epic: symbol,
            market: MARKET_MAP[symbol] ?? symbol,
            direction: signal.direction,
            signalType: signal.signalType,
            timeframe: signal.timeframe,
            entryPrice: signal.entryPrice,
            stopLoss: signal.stopLoss,
            takeProfit: signal.takeProfit,
            confidence: signal.confidence,
            killZone: signal.killZone,
            notes: signal.notes,
            htfBias: signal.htfBias,
            structureContext: signal.structureContext,
            executed: false,
          })
          .returning();

        if (!dailyRiskCheck.allowed) {
          logger.info(
            { reason: dailyRiskCheck.reason },
            "Signal found but skipping execution — daily risk limit active"
          );
          continue;
        }

        // ── Minimum stop distance enforcement ────────────────────────────────
        const minStop = getMinStopDistance(symbol, signal.entryPrice);
        const rawStopDistance = Math.abs(signal.entryPrice - signal.stopLoss);

        if (rawStopDistance < minStop) {
          logger.warn(
            {
              symbol,
              rawStopDistance: rawStopDistance.toFixed(4),
              minStop: minStop.toFixed(4),
            },
            "Stop too tight — widening to instrument minimum"
          );
          if (signal.direction === "BUY") {
            signal.stopLoss   = signal.entryPrice - minStop;
            signal.takeProfit = signal.entryPrice + minStop * settings.minRR;
          } else {
            signal.stopLoss   = signal.entryPrice + minStop;
            signal.takeProfit = signal.entryPrice - minStop * settings.minRR;
          }
        }
        // ─────────────────────────────────────────────────────────────────────

        const sizeResult = calculatePositionSize({
          accountBalance: balance,
          riskPerTrade:   settings.riskPerTrade,
          entryPrice:     signal.entryPrice,
          stopLoss:       signal.stopLoss,
          symbol,
          minSize: getMinSizeForSymbol(symbol),
          maxSize: getMaxSizeForSymbol(symbol),
          decimalPlaces:  getDecimalPlacesForSymbol(symbol),
        });

        logger.info(
          {
            symbol,
            size: sizeResult.size,
            riskAmount: sizeResult.riskAmount,
            stopDistance: sizeResult.stopDistance,
            stopLoss: signal.stopLoss,
            takeProfit: signal.takeProfit,
          },
          "Position size calculated"
        );

        if (sizeResult.size <= 0) {
          logger.warn(
            { symbol, sizeResult },
            "Calculated size is 0 — skipping. Risk % or balance may be too low."
          );
          continue;
        }

        try {
          logger.info(
            {
              symbol,
              side: signal.direction === "BUY" ? "Buy" : "Sell",
              qty: sizeResult.size,
              stop: formatPrice(signal.stopLoss, symbol),
              target: formatPrice(signal.takeProfit, symbol),
            },
            "Placing order on Bybit…"
          );

          const orderResult = await state.client.createOrder({
            symbol,
            side:       signal.direction === "BUY" ? "Buy" : "Sell",
            qty:        sizeResult.size,
            stopLoss:   formatPrice(signal.stopLoss, symbol),
            takeProfit: formatPrice(signal.takeProfit, symbol),
          });

          logger.info(
            { symbol, orderId: orderResult.orderId },
            "Order placed successfully"
          );

          await db
            .update(signalsTable)
            .set({ executed: true })
            .where(eq(signalsTable.id, savedSignal.id));

          await db.insert(tradesTable).values({
            dealId:     orderResult.orderId,
            epic:       symbol,
            market:     MARKET_MAP[symbol] ?? symbol,
            direction:  signal.direction,
            size:       sizeResult.size,
            entryPrice: signal.entryPrice,
            stopLoss:   signal.stopLoss,
            takeProfit: signal.takeProfit,
            strategy:   `ICT-${signal.signalType}`,
            signalId:   savedSignal.id,
            notes:      signal.notes,
          });

          logger.info(
            {
              symbol,
              orderId: orderResult.orderId,
              size: sizeResult.size,
              direction: signal.direction,
            },
            "✅ Trade executed successfully"
          );
        } catch (execErr) {
          const errMsg =
            execErr instanceof Error ? execErr.message : String(execErr);
          logger.error(
            { symbol, size: sizeResult.size, direction: signal.direction },
            `❌ Failed to execute trade on ${symbol}: ${errMsg}`
          );
        }
      } catch (marketErr) {
        const errMsg =
          marketErr instanceof Error ? marketErr.message : String(marketErr);
        logger.error({ symbol }, `Error scanning market [${symbol}]: ${errMsg}`);
      }

      // Small delay between symbols to avoid rate limits
      await new Promise((r) => setTimeout(r, 500));
    }

    state.lastScan = new Date();
    logger.info(
      { scanEnd: new Date().toISOString(), symbolsScanned: symbols.length },
      "=== Market scan complete ==="
    );
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error({ err: errMsg }, "Fatal error during market scan");
    state.error = errMsg;
  }
}

// ─────────────────────────────────────────────
// Position monitor
// ─────────────────────────────────────────────

async function monitorPositions() {
  if (!state.client) return;

  try {
    const openTrades = await db
      .select()
      .from(tradesTable)
      .where(isNull(tradesTable.result));

    if (openTrades.length > 0) {
      logger.info({ openTrades: openTrades.length }, "Monitoring open positions");
    }

    // Fetch all Bybit positions once
    const bybitPositions = await state.client.getPositions();

    for (const trade of openTrades) {
      if (!trade.dealId) continue;

      try {
        // Check if position is still open on Bybit
        const pos = bybitPositions.find(
          (p) =>
            p.symbol === trade.epic &&
            ((trade.direction === "BUY" && p.side === "Buy") ||
              (trade.direction === "SELL" && p.side === "Sell"))
        );

        if (!pos) {
          // Position closed — calculate P&L from ticker
          const ticker = await state.client.getTicker(trade.epic);
          const exitPrice = ticker
            ? (ticker.bid1Price + ticker.ask1Price) / 2
            : trade.entryPrice;

          const profit =
            trade.direction === "BUY"
              ? (exitPrice - trade.entryPrice) * trade.size
              : (trade.entryPrice - exitPrice) * trade.size;

          const result =
            profit > 0 ? "WIN" : profit < 0 ? "LOSS" : "BREAKEVEN";
          const stopDistance = Math.abs(trade.entryPrice - trade.stopLoss);
          const rr =
            stopDistance > 0
              ? Math.abs(profit) / (stopDistance * trade.size)
              : 0;

          await db
            .update(tradesTable)
            .set({
              exitPrice,
              profit,
              exitDate: new Date(),
              result,
              riskRewardRatio: rr,
            })
            .where(eq(tradesTable.id, trade.id));

          logger.info(
            {
              tradeId: trade.id,
              symbol: trade.epic,
              result,
              profit: profit.toFixed(4),
              rr: rr.toFixed(2),
            },
            "Trade closed"
          );
        }
      } catch (err) {
        logger.error({ err, tradeId: trade.id }, "Error monitoring position");
      }
    }
  } catch (err) {
    logger.error({ err }, "Error monitoring positions");
  }
}

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

export async function startBot(): Promise<void> {
  if (state.running) throw new Error("Bot is already running");

  const settings = await loadSettings();

  if (!settings.bybitApiKey || !settings.bybitApiSecret) {
    throw new Error(
      "Bybit credentials not configured. " +
        "Set BYBIT_API_KEY and BYBIT_API_SECRET as environment variables, " +
        "or save them via the Settings endpoint."
    );
  }

  const mode = settings.bybitDemo ? "DEMO" : settings.bybitTestnet ? "TESTNET" : "LIVE";
  logger.info({ mode }, "Connecting to Bybit");

  state.client = new BybitApiClient(
    settings.bybitApiKey,
    settings.bybitApiSecret,
    settings.bybitTestnet,
    settings.bybitDemo
  );

  // Validate credentials before proceeding
  state.sessionValid = await state.client.isSessionValid();
  if (!state.sessionValid) {
    state.client = null;
    throw new Error(
      "Bybit credential validation failed — check BYBIT_API_KEY and BYBIT_API_SECRET"
    );
  }

  state.running = true;
  state.startedAt = new Date();
  state.error = null;

  logger.info({ scanIntervalMinutes: 5 }, "Trading bot started — running first scan immediately");

  await scanMarkets();
  await monitorPositions();

  state.scanInterval = setInterval(async () => {
    if (state.running) {
      await scanMarkets();
      await monitorPositions();
    }
  }, 5 * 60 * 1000);
}

export async function stopBot(): Promise<void> {
  if (!state.running) throw new Error("Bot is not running");

  if (state.scanInterval) {
    clearInterval(state.scanInterval);
    state.scanInterval = null;
  }

  if (state.client) {
    state.client.destroy();
    state.client = null;
  }

  state.running = false;
  state.startedAt = null;
  state.sessionValid = false;

  logger.info("Trading bot stopped");
}

export function getBotClient(): BybitApiClient | null {
  return state.client;
}
