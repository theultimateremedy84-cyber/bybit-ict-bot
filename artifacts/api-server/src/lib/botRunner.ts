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
import { buildOrderFlowContext, computeATR, type OrderFlowContext } from "./orderFlow";
import { getInstrumentSpec, roundToTick } from "./instruments";
import {
  calculatePositionSize,
  canOpenNewTrade,
  formatPrice,
  getMinSizeForSymbol,
  getMaxSizeForSymbol,
  getDecimalPlacesForSymbol,
  getMinStopDistance,
  calculateInstitutionalSize,
  checkPortfolioRisk,
  computeTradeManagement,
  getVolatilityStopFloor,
  type OpenExposure,
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
  watchdog: NodeJS.Timeout | null;
  sessionValid: boolean;
  scanning: boolean;
  lastTick: Date | null;
}

const state: BotState = {
  running: false,
  startedAt: null,
  lastScan: null,
  error: null,
  client: null,
  scanInterval: null,
  watchdog: null,
  sessionValid: false,
  scanning: false,
  lastTick: null,
};

/** Persist the "bot should be running" flag so a restart can resume itself. */
async function persistBotEnabled(enabled: boolean): Promise<void> {
  try {
    const rows = await db.select().from(botSettingsTable).limit(1);
    if (rows.length === 0) {
      await db.insert(botSettingsTable).values({ botEnabled: enabled });
    } else {
      await db
        .update(botSettingsTable)
        .set({ botEnabled: enabled, updatedAt: new Date() })
        .where(eq(botSettingsTable.id, rows[0].id));
    }
  } catch (err) {
    logger.warn({ err }, "Could not persist bot_enabled flag");
  }
}

export async function isBotEnabledInDb(): Promise<boolean> {
  try {
    const rows = await db.select().from(botSettingsTable).limit(1);
    return rows[0]?.botEnabled === true;
  } catch {
    return false;
  }
}

export function getBotState() {
  return {
    running: state.running,
    uptime: state.startedAt
      ? Math.floor((Date.now() - state.startedAt.getTime()) / 1000)
      : null,
    lastScan: state.lastScan?.toISOString() ?? null,
    lastTick: state.lastTick?.toISOString() ?? null,
    scanning: state.scanning,
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
      // ── Institutional order-flow layer ──────────────────────────────────
      useOrderFlow:            settings.useOrderFlow ?? true,
      orderFlowVetoThreshold:  settings.orderFlowVetoThreshold ?? 25,
      requireFlowConfirmation: settings.requireFlowConfirmation ?? true,
      minFlowConfirmation:     settings.minFlowConfirmation ?? 12,
      cryptoMode:              settings.cryptoMode ?? true,
      maxRelativeSpread:       settings.maxRelativeSpread ?? 0.0008,
    };

    // Exposure snapshot used by the correlation / leverage gate below.
    const openExposures: OpenExposure[] = bybitPositions.map((p) => ({
      symbol: p.symbol,
      direction: p.side === "Buy" ? "BUY" : "SELL",
      notional: p.size * p.avgPrice,
    }));

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

        const [dailyCandles, h4Candles, h1Candles, m15Candles, m5Candles, ticker] =
          await Promise.all([
            state.client.getCandles(symbol, "D",   200),  // ~9 months for monthly/weekly derivation
            state.client.getCandles(symbol, "240",  50),  // 4h
            state.client.getCandles(symbol, "60",  100),  // 1h
            state.client.getCandles(symbol, "15",  200),  // 15m — liquidity pools + ATR
            state.client.getCandles(symbol, "5",   288),  // 5m  — ~24h for volume profile + VWAP
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

        // ── Institutional order flow ─────────────────────────────────────
        // Book imbalance, aggressor delta, whale prints, open interest,
        // funding, positioning, volume profile, VWAP, absorption and the
        // liquidity map — all fetched in parallel, degrading gracefully.
        let flow: OrderFlowContext | null = null;
        if (strategyConfig.useOrderFlow) {
          try {
            flow = await buildOrderFlowContext(state.client, symbol, {
              m5Candles,
              m15Candles,
              dailyCandles,
              currentPrice: ticker.lastPrice,
            });
            logger.info(
              {
                symbol,
                flowScore: flow.score,
                flowBias: flow.bias,
                tapeDelta: flow.tape?.deltaRatio,
                whaleDelta: flow.tape?.whaleDeltaRatio,
                bookImbalance: flow.book?.imbalance,
                oi: flow.oi?.interpretation,
                funding: flow.funding?.annualisedPct,
                absorption: flow.absorption?.direction ?? null,
                pools: flow.liquidityPools.length,
                atr: flow.atr,
              },
              "Order flow context"
            );
          } catch (flowErr) {
            logger.warn({ symbol, err: flowErr }, "Order flow unavailable — falling back to structure-only");
          }
        }

        const signal = await analyzeMarket({
          symbol,
          market: MARKET_MAP[symbol] ?? symbol,
          monthlyCandles,
          weeklyCandles,
          dailyCandles,
          h4Candles,
          h1Candles,
          m15Candles,
          currentBid: ticker.bid1Price,
          currentOffer: ticker.ask1Price,
          config: strategyConfig,
          flow,
        });

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
            orderFlowScore: signal.orderFlowScore,
            orderFlowBias: signal.orderFlowBias,
            orderFlowNotes: signal.orderFlowNotes,
            executed: false,
          })
          .returning();

        // ── REVERSE MODE ─────────────────────────────────────────────────────
        // Execute the exact opposite of the generated signal. The signal is
        // still stored above in its ORIGINAL form (so analytics stay honest);
        // only the execution is mirrored.
        //
        // A correct reversal is not just flipping the side: stop and target
        // must swap too, otherwise you keep the old stop distance and destroy
        // the payoff maths. Old take-profit becomes the new stop, old stop
        // becomes the new take-profit. R:R therefore inverts (a 1:2 setup
        // becomes 1:0.5), and position size is recomputed further below
        // against the new, wider stop.
        //
        // Entry style is forced to MARKET: a LIMIT price computed as a pullback
        // for a BUY sits on the wrong side of the book for a SELL and would
        // either fill instantly at a bad price or never fill at all.
        const reverseMode = (settings as typeof settings & { reverseSignals?: boolean }).reverseSignals ?? false;

        if (reverseMode) {
          const originalDirection  = signal.direction;
          const originalStopLoss   = signal.stopLoss;
          const originalTakeProfit = signal.takeProfit;

          signal.direction  = originalDirection === "BUY" ? "SELL" : "BUY";
          signal.stopLoss   = originalTakeProfit;
          signal.takeProfit = originalStopLoss;
          signal.entryStyle = "MARKET";

          const revRisk   = Math.abs(signal.entryPrice - signal.stopLoss);
          const revReward = Math.abs(signal.takeProfit - signal.entryPrice);
          signal.riskReward = revRisk > 0 ? revReward / revRisk : 0;
          signal.notes = `[REVERSED] Original signal was ${originalDirection} (stop ${originalStopLoss}, target ${originalTakeProfit}). ${signal.notes ?? ""}`.trim();

          logger.warn(
            {
              symbol,
              originalDirection,
              executedDirection: signal.direction,
              stopLoss: signal.stopLoss,
              takeProfit: signal.takeProfit,
              reversedRR: signal.riskReward.toFixed(2),
            },
            "🔄 Reverse mode active — executing the opposite of the generated signal"
          );
        }

        if (!dailyRiskCheck.allowed) {
          logger.info(
            { reason: dailyRiskCheck.reason },
            "Signal found but skipping execution — daily risk limit active"
          );
          continue;
        }

        // ── Instrument spec (real Bybit contract rules) ──────────────────────
        const spec = await getInstrumentSpec(state.client, symbol);

        // ── Volatility-aware minimum stop distance ───────────────────────────
        // ATR-based rather than a fixed percentage, so the stop adapts to the
        // regime instead of being noise-tight in expansion and absurdly wide
        // in a dead session.
        const atr = flow?.atr || computeATR(m15Candles, 14);
        const minStop = atr > 0
          ? getVolatilityStopFloor(signal.entryPrice, atr)
          : getMinStopDistance(symbol, signal.entryPrice);
        const rawStopDistance = Math.abs(signal.entryPrice - signal.stopLoss);

        if (rawStopDistance < minStop) {
          logger.warn(
            {
              symbol,
              rawStopDistance: rawStopDistance.toFixed(4),
              minStop: minStop.toFixed(4),
              atr: atr.toFixed(4),
            },
            "Stop inside the volatility floor — widening"
          );
          // In reverse mode the payoff ratio is inherited from the mirrored
          // levels, so do not re-impose minRR here — that would silently undo
          // the mirror and hand back an over-optimistic target.
          const floorRR = reverseMode
            ? Math.max(signal.riskReward, 0.2)
            : settings.minRR;
          if (signal.direction === "BUY") {
            signal.stopLoss   = signal.entryPrice - minStop;
            signal.takeProfit = signal.entryPrice + minStop * floorRR;
          } else {
            signal.stopLoss   = signal.entryPrice + minStop;
            signal.takeProfit = signal.entryPrice - minStop * floorRR;
          }
        }

        // Snap every price onto the instrument's tick grid.
        signal.entryPrice = roundToTick(signal.entryPrice, spec);
        signal.stopLoss   = roundToTick(signal.stopLoss, spec);
        signal.takeProfit = roundToTick(signal.takeProfit, spec);

        // ── Position sizing against contract limits and leverage ceiling ─────
        const sizeResult = calculateInstitutionalSize({
          accountBalance: balance,
          riskPerTrade:   settings.riskPerTrade,
          entryPrice:     signal.entryPrice,
          stopLoss:       signal.stopLoss,
          spec,
          maxLeverage:    settings.maxLeverage ?? 5,
          confidence:     signal.confidence,
          scaleByConfidence: settings.scaleByConfidence ?? true,
        });

        if (sizeResult.rejected || sizeResult.qty <= 0) {
          logger.warn({ symbol, sizeResult }, `Sizing rejected: ${sizeResult.reason ?? "qty is zero"}`);
          continue;
        }

        // ── Portfolio-level correlation and leverage gate ────────────────────
        const portfolioCheck = checkPortfolioRisk({
          symbol,
          direction: signal.direction,
          newNotional: sizeResult.notional,
          accountBalance: balance,
          openExposures,
          maxPerCorrelationGroup: settings.maxPerCorrelationGroup ?? 2,
          maxDirectionalLeverage: settings.maxDirectionalLeverage ?? 3,
          maxTotalLeverage:       settings.maxTotalLeverage ?? 5,
        });

        if (!portfolioCheck.allowed) {
          logger.info({ symbol, reason: portfolioCheck.reason }, "Blocked by portfolio risk gate");
          continue;
        }

        logger.info(
          {
            symbol,
            qty: sizeResult.qty,
            notional: sizeResult.notional.toFixed(2),
            leverageUsed: sizeResult.leverageUsed.toFixed(2),
            riskAmount: sizeResult.riskAmount.toFixed(2),
            effectiveRisk: sizeResult.effectiveRiskPercent.toFixed(3) + "%",
            entryStyle: signal.entryStyle,
            rr: signal.riskReward.toFixed(2),
          },
          "Position sized"
        );

        try {
          // Passive entry at the zone when structure wants a pullback; market
          // order only when price is already at the level. This alone removes
          // a meaningful chunk of adverse fill cost.
          const orderResult =
            signal.entryStyle === "LIMIT"
              ? await state.client.createLimitOrder({
                  symbol,
                  side:       signal.direction === "BUY" ? "Buy" : "Sell",
                  qty:        sizeResult.qty,
                  price:      signal.entryPrice,
                  stopLoss:   signal.stopLoss,
                  takeProfit: signal.takeProfit,
                  postOnly:   false,
                })
              : await state.client.createOrder({
                  symbol,
                  side:       signal.direction === "BUY" ? "Buy" : "Sell",
                  qty:        sizeResult.qty,
                  stopLoss:   signal.stopLoss,
                  takeProfit: signal.takeProfit,
                });

          openExposures.push({
            symbol,
            direction: signal.direction,
            notional: sizeResult.notional,
          });

          logger.info(
            { symbol, orderId: orderResult.orderId, entryStyle: signal.entryStyle },
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
            size:       sizeResult.qty,
            entryPrice: signal.entryPrice,
            stopLoss:   signal.stopLoss,
            takeProfit: signal.takeProfit,
            strategy:   `${reverseMode ? "REV-" : ""}ICT-${signal.signalType}`,
            signalId:   savedSignal.id,
            notes:      signal.notes,
            orderFlowScore: signal.orderFlowScore,
          });

          logger.info(
            {
              symbol,
              orderId: orderResult.orderId,
              size: sizeResult.qty,
              direction: signal.direction,
            },
            "✅ Trade executed successfully"
          );
        } catch (execErr) {
          const errMsg =
            execErr instanceof Error ? execErr.message : String(execErr);
          logger.error(
            { symbol, size: sizeResult.qty, direction: signal.direction },
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

        if (pos) {
          // ── Live trade management: break-even, then ATR trailing ──────────
          try {
            const spec = await getInstrumentSpec(state.client, trade.epic);
            const m15 = await state.client.getCandles(trade.epic, "15", 100);
            const atr = computeATR(m15, 14);
            const currentPrice = pos.avgPrice + pos.unrealisedPnl / (pos.size || 1) *
              (pos.side === "Buy" ? 1 : -1);

            const action = computeTradeManagement({
              direction: trade.direction === "BUY" ? "BUY" : "SELL",
              entryPrice: trade.entryPrice,
              currentStop: pos.stopLoss || trade.stopLoss,
              currentPrice,
              initialRisk: Math.abs(trade.entryPrice - trade.stopLoss),
              atr,
              spec,
              breakEvenAtR: 1.0,
              trailAtR: 1.5,
              trailAtrMultiple: 1.5,
              enableTrailing: true,
            });

            if (action.newStop !== null) {
              await state.client.setTradingStop({
                symbol: trade.epic,
                stopLoss: action.newStop,
                positionIdx: pos.positionIdx,
              });
              await db
                .update(tradesTable)
                .set({ stopLoss: action.newStop })
                .where(eq(tradesTable.id, trade.id));
              logger.info(
                { symbol: trade.epic, newStop: action.newStop, r: action.rMultiple.toFixed(2) },
                action.reason
              );
            }
          } catch (mgmtErr) {
            logger.warn({ err: mgmtErr, symbol: trade.epic }, "Trade management update failed");
          }
        }

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

/** One scan+monitor cycle, guarded so overlapping ticks can never stack up. */
async function tick(): Promise<void> {
  if (state.scanning) {
    logger.warn("Previous cycle still running — skipping this tick");
    return;
  }
  state.scanning = true;
  state.lastTick = new Date();
  try {
    await scanMarkets();
    await monitorPositions();
  } catch (err) {
    // Never let an unhandled rejection escape the interval — that would kill
    // the process (and therefore the bot) under Node's default behaviour.
    const msg = err instanceof Error ? err.message : String(err);
    state.error = msg;
    logger.error({ err: msg }, "Unhandled error in bot cycle — bot stays running");
  } finally {
    state.scanning = false;
  }
}

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
  const validation = await state.client.validateCredentials();
  state.sessionValid = validation.ok;
  if (!validation.ok) {
    state.client = null;
    const reason = validation.reason ?? "unknown error";
    if (reason.includes("HTTP 403")) {
      throw new Error(
        `Bybit refused the connection before it reached the API (HTTP 403). ` +
          `This host's region/IP is blocked by Bybit — it is not a credential problem. ` +
          `Redeploy to an allowed region or set BYBIT_PROXY_URL. Details: ${reason}`
      );
    }
    throw new Error(
      `Bybit credential validation failed (${mode}) — check BYBIT_API_KEY / BYBIT_API_SECRET ` +
        `and make sure the keys were created in the ${mode} environment. Details: ${reason}`
    );
  }

  state.running = true;
  state.startedAt = new Date();
  state.error = null;

  await persistBotEnabled(true);

  logger.info({ scanIntervalMinutes: 5 }, "Trading bot started — running first scan in background");

  // Fire the first cycle in the background so POST /api/bot/start returns
  // immediately. A full scan can take minutes; awaiting it here made the HTTP
  // request time out and the dashboard then re-rendered the bot as "off".
  void tick();

  state.scanInterval = setInterval(() => {
    if (state.running) void tick();
  }, 5 * 60 * 1000);

  // Watchdog: if the interval was ever lost (unhandled timer error, host
  // suspend/resume), restore it instead of silently going idle.
  if (state.watchdog) clearInterval(state.watchdog);
  state.watchdog = setInterval(() => {
    if (!state.running) return;
    if (!state.scanInterval) {
      logger.warn("Scan interval was missing — restoring it");
      state.scanInterval = setInterval(() => {
        if (state.running) void tick();
      }, 5 * 60 * 1000);
    }
    const stale =
      state.lastTick && Date.now() - state.lastTick.getTime() > 15 * 60 * 1000;
    if (stale && !state.scanning) {
      logger.warn("No cycle for 15 minutes — forcing a scan");
      void tick();
    }
  }, 60 * 1000);
}

/** Resume the bot on process boot when the persisted flag says it was on. */
export async function resumeBotIfEnabled(): Promise<void> {
  if (state.running) return;
  if (!(await isBotEnabledInDb())) return;
  logger.info("bot_enabled=true in DB — resuming bot after restart");
  try {
    await startBot();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    state.error = msg;
    logger.error({ err: msg }, "Resume failed — retrying in 60s");
    setTimeout(() => void resumeBotIfEnabled(), 60_000);
  }
}

export async function stopBot(): Promise<void> {
  if (!state.running) throw new Error("Bot is not running");

  if (state.scanInterval) {
    clearInterval(state.scanInterval);
    state.scanInterval = null;
  }

  if (state.watchdog) {
    clearInterval(state.watchdog);
    state.watchdog = null;
  }

  await persistBotEnabled(false);

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
