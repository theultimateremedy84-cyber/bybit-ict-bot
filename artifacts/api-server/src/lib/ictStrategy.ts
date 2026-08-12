/**
 * ICT (Inner Circle Trader) Strategy Engine
 *
 * Multi-Timeframe Order Flow + Smart Money Concepts:
 *
 * MANDATORY HIGHER TIMEFRAME GATE (executed first):
 *   1. Monthly  — macro order flow bias
 *   2. Weekly   — intermediate order flow bias
 *   3. Daily    — near-term order flow bias
 *   A majority (2/3 or 3/3) must agree on direction before entry logic runs.
 *   A genuine split (1 vs 1) blocks trading; a majority always wins even if
 *   the minority TF is OPPOSITE — this is normal during pullbacks.
 *
 * ENTRY TIMEFRAME ANALYSIS (H4 → H1 → M15):
 *   - Market Structure (BOS / ChoCH)
 *   - Order Blocks
 *   - Fair Value Gaps (FVG)
 *   - Liquidity Sweeps
 *   - Kill Zones (London / New York / Asian)
 *
 * FIX LOG:
 *   [Bug #1] calculateEntryParams: now falls back to swing-based stop when
 *            no Order Block or FVG is present, instead of returning null and
 *            silently discarding valid BOS / ChoCH / liquidity-sweep signals.
 *   [Bug #2] analyzeHTFOrderFlow: removed the over-strict "conflict" gate
 *            that blocked trading whenever any one HTF was opposite the other
 *            two.  Majority (≥2/3) now wins regardless of the minority TF.
 *   [Bug #3] analyzeMarket: H4 counter-trend was a hard veto (return null).
 *            Changed to a soft confidence penalty (−15 pts) so valid signals
 *            during HTF-aligned pullbacks are still surfaced.
 *   [Bug #4] calculateConfidence: added h4ConflictsHTF parameter; opposing H4
 *            reduces the score instead of killing the signal entirely.
 *   [Bug #5] getCurrentKillZone: "LONDON" window was 02:00–05:00 UTC (late
 *            Asian / pre-London overlap), not the real ICT London Kill Zone
 *            (07:00–10:00 UTC = 02:00–05:00 EST).  Corrected; Asian window
 *            extended to 23:00–02:00 UTC.  This was the primary cause of
 *            losses during the real London session and false confidence boosts
 *            during the late-Asian period.
 *   [Bug #6] London manipulation window (07:00–08:30 UTC): added
 *            isLondonManipulationWindow() guard that (a) blocks fallback
 *            swing/fixed-stop entries — only OB- or FVG-anchored entries
 *            allowed, (b) filters Order Blocks formed within the last 90 min
 *            (manipulation candles), and (c) adds −10 extra confidence
 *            penalty when H4 also conflicts HTF (cumulative −25).
 *   [Bug #7] isNewsBlackout(): hard block on entries 15 min either side of
 *            13:30 UTC (US macro) and 09:00 UTC (EU macro) — the two most
 *            common stop-hunting news windows during the London and NY AM
 *            sessions.
 */

import type { BybitCandle } from "./bybitApi";
import {
  refineWithLiquidity,
  type OrderFlowContext,
} from "./orderFlow";

// Keep this alias so the rest of the file is unchanged.
type CapitalCandle = BybitCandle;

export type Direction = "BUY" | "SELL";
export type KillZone = "LONDON" | "NEW_YORK" | "ASIAN" | null;
export type SignalType =
  | "ORDER_BLOCK"
  | "FAIR_VALUE_GAP"
  | "LIQUIDITY_SWEEP"
  | "BOS"
  | "CHOCH"
  | "COMBINED";
export type Trend = "BULLISH" | "BEARISH" | "SIDEWAYS";

export interface OHLC {
  time: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface SwingPoint {
  index: number;
  price: number;
  time: Date;
  type: "HIGH" | "LOW";
}

export interface OrderBlock {
  direction: Direction;
  top: number;
  bottom: number;
  time: Date;
  index: number;
  mitigated: boolean;
  strength: number;
}

export interface FairValueGap {
  direction: Direction;
  top: number;
  bottom: number;
  timeStart: Date;
  timeEnd: Date;
  filled: boolean;
  midpoint: number;
}

export interface LiquiditySweep {
  direction: Direction;
  level: number;
  time: Date;
  strength: number;
}

export interface MarketStructure {
  trend: Trend;
  lastBOS: { price: number; time: Date; direction: Direction } | null;
  lastChoCH: { price: number; time: Date; direction: Direction } | null;
  swingHighs: SwingPoint[];
  swingLows: SwingPoint[];
  currentHighs: number[];
  currentLows: number[];
}

export interface OrderFlowLevel {
  timeframe: string;
  bias: Trend;
  strength: number;
  prevCandleHigh: number;
  prevCandleLow: number;
  keyOrderBlock: OrderBlock | null;
  structure: MarketStructure;
  summary: string;
}

export interface HTFOrderFlow {
  monthly: OrderFlowLevel;
  weekly: OrderFlowLevel;
  daily: OrderFlowLevel;
  agreedDirection: Direction | null;
  alignmentCount: number;
  reason: string;
}

export interface ICTSignal {
  direction: Direction;
  signalType: SignalType;
  timeframe: string;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  confidence: number;
  killZone: KillZone;
  notes: string;
  htfBias: Trend;
  structureContext: string;
  /** Signed institutional order-flow score, -100..+100 (0 when disabled). */
  orderFlowScore: number;
  /** BULLISH / BEARISH / NEUTRAL read from the order-flow engine. */
  orderFlowBias: "BULLISH" | "BEARISH" | "NEUTRAL";
  /** Human-readable order-flow evidence attached to this signal. */
  orderFlowNotes: string;
  /** Realised R:R after liquidity-aware target placement. */
  riskReward: number;
  /** Suggested entry style — passive limit at the zone, or market. */
  entryStyle: "LIMIT" | "MARKET";
}

// ─────────────────────────────────────────────
// Candle helpers
// ─────────────────────────────────────────────

function candlesToOHLC(candles: CapitalCandle[]): OHLC[] {
  return candles.map((c) => ({
    time: new Date(c.snapshotTime),
    open: (c.openPrice.bid + c.openPrice.ask) / 2,
    high: (c.highPrice.bid + c.highPrice.ask) / 2,
    low: (c.lowPrice.bid + c.lowPrice.ask) / 2,
    close: (c.closePrice.bid + c.closePrice.ask) / 2,
    volume: c.lastTradedVolume,
  }));
}

// ─────────────────────────────────────────────
// Market Structure
// ─────────────────────────────────────────────

export function detectSwingPoints(candles: OHLC[], lookback = 3): SwingPoint[] {
  const swings: SwingPoint[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const c = candles[i];
    const before = candles.slice(i - lookback, i);
    const after = candles.slice(i + 1, i + lookback + 1);

    if (before.every((x) => x.high <= c.high) && after.every((x) => x.high <= c.high)) {
      swings.push({ index: i, price: c.high, time: c.time, type: "HIGH" });
    }
    if (before.every((x) => x.low >= c.low) && after.every((x) => x.low >= c.low)) {
      swings.push({ index: i, price: c.low, time: c.time, type: "LOW" });
    }
  }
  return swings;
}

export function analyzeMarketStructure(candles: OHLC[]): MarketStructure {
  const swings = detectSwingPoints(candles);
  const swingHighs = swings.filter((s) => s.type === "HIGH");
  const swingLows = swings.filter((s) => s.type === "LOW");

  let lastBOS: MarketStructure["lastBOS"] = null;
  let lastChoCH: MarketStructure["lastChoCH"] = null;
  let trend: Trend = "SIDEWAYS";

  if (swingHighs.length >= 2 && swingLows.length >= 2) {
    const prevHigh = swingHighs[swingHighs.length - 2];
    const lastHigh = swingHighs[swingHighs.length - 1];
    const prevLow = swingLows[swingLows.length - 2];
    const lastLow = swingLows[swingLows.length - 1];
    const lastCandle = candles[candles.length - 1];

    if (lastCandle.close > prevHigh.price && lastHigh.price > prevHigh.price) {
      trend = "BULLISH";
      lastBOS = { price: prevHigh.price, time: lastHigh.time, direction: "BUY" };
    } else if (lastCandle.close < prevLow.price && lastLow.price < prevLow.price) {
      trend = "BEARISH";
      lastBOS = { price: prevLow.price, time: lastLow.time, direction: "SELL" };
    }

    if (trend === "BULLISH" && lastCandle.close < prevLow.price) {
      lastChoCH = { price: prevLow.price, time: lastCandle.time, direction: "SELL" };
    } else if (trend === "BEARISH" && lastCandle.close > prevHigh.price) {
      lastChoCH = { price: prevHigh.price, time: lastCandle.time, direction: "BUY" };
    }
  }

  return {
    trend,
    lastBOS,
    lastChoCH,
    swingHighs,
    swingLows,
    currentHighs: swingHighs.slice(-5).map((s) => s.price),
    currentLows: swingLows.slice(-5).map((s) => s.price),
  };
}

// ─────────────────────────────────────────────
// HTF Order Flow Analysis
// ─────────────────────────────────────────────

function analyzeOrderFlow(candles: OHLC[], timeframe: string): OrderFlowLevel {
  const structure = analyzeMarketStructure(candles);

  let bullishScore = 0;
  let bearishScore = 0;

  if (structure.trend === "BULLISH") bullishScore += 40;
  if (structure.trend === "BEARISH") bearishScore += 40;

  if (structure.lastBOS?.direction === "BUY") bullishScore += 25;
  if (structure.lastBOS?.direction === "SELL") bearishScore += 25;

  const recent = candles.slice(-5);
  for (const c of recent) {
    if (c.close > c.open) bullishScore += 3;
    else if (c.close < c.open) bearishScore += 3;
  }

  if (candles.length >= 10) {
    const tenBack = candles[candles.length - 10];
    const last = candles[candles.length - 1];
    if (last.close > tenBack.open) bullishScore += 10;
    else if (last.close < tenBack.open) bearishScore += 10;
  }

  const highs = structure.swingHighs.slice(-3).map((s) => s.price);
  const lows = structure.swingLows.slice(-3).map((s) => s.price);

  const hhhl =
    highs.length >= 2 &&
    lows.length >= 2 &&
    highs[highs.length - 1] > highs[highs.length - 2] &&
    lows[lows.length - 1] > lows[lows.length - 2];
  const lhll =
    highs.length >= 2 &&
    lows.length >= 2 &&
    highs[highs.length - 1] < highs[highs.length - 2] &&
    lows[lows.length - 1] < lows[lows.length - 2];

  if (hhhl) bullishScore += 10;
  if (lhll) bearishScore += 10;

  const total = bullishScore + bearishScore;
  const bias: Trend =
    total === 0
      ? "SIDEWAYS"
      : bullishScore > bearishScore
      ? "BULLISH"
      : bearishScore > bullishScore
      ? "BEARISH"
      : "SIDEWAYS";

  const strength = total === 0 ? 50 : Math.round((Math.max(bullishScore, bearishScore) / total) * 100);

  const obs = detectOrderBlocks(candles.slice(-30), structure);
  const keyOB = obs.sort((a, b) => b.strength - a.strength)[0] ?? null;

  const prevCandle = candles[candles.length - 2] ?? candles[candles.length - 1];

  const summary = [
    `${timeframe}: ${bias} (${strength}% conviction)`,
    structure.lastBOS ? `BOS @ ${structure.lastBOS.price.toFixed(2)} ${structure.lastBOS.direction}` : null,
    structure.lastChoCH ? `ChoCH @ ${structure.lastChoCH.price.toFixed(2)} ${structure.lastChoCH.direction}` : null,
    hhhl ? "HH/HL pattern" : lhll ? "LH/LL pattern" : null,
    keyOB ? `Key OB: ${keyOB.bottom.toFixed(2)}–${keyOB.top.toFixed(2)}` : null,
  ]
    .filter(Boolean)
    .join(" | ");

  return {
    timeframe,
    bias,
    strength,
    prevCandleHigh: prevCandle.high,
    prevCandleLow: prevCandle.low,
    keyOrderBlock: keyOB,
    structure,
    summary,
  };
}

/**
 * HTF alignment gate — majority wins.
 * 2/3 or 3/3 agreement → trade allowed in that direction.
 * Only a genuine split (1 vs 1, or all SIDEWAYS) blocks trading.
 */
export function analyzeHTFOrderFlow(
  monthlyCandles: CapitalCandle[],
  weeklyCandles: CapitalCandle[],
  dailyCandles: CapitalCandle[]
): HTFOrderFlow {
  const monthly = analyzeOrderFlow(candlesToOHLC(monthlyCandles), "Monthly");
  const weekly = analyzeOrderFlow(candlesToOHLC(weeklyCandles), "Weekly");
  const daily = analyzeOrderFlow(candlesToOHLC(dailyCandles), "Daily");

  const levels = [monthly, weekly, daily];

  const bullishCount = levels.filter((l) => l.bias === "BULLISH").length;
  const bearishCount = levels.filter((l) => l.bias === "BEARISH").length;

  let agreedDirection: Direction | null = null;
  let alignmentCount = 0;
  let reason = "";

  if (bullishCount >= 2) {
    agreedDirection = "BUY";
    alignmentCount = bullishCount;
    const minority = bearishCount > 0 ? ` (1 opposing — normal pullback, confidence reduced)` : "";
    reason =
      bullishCount === 3
        ? `ALL 3 HTFs BULLISH — M:BULLISH W:BULLISH D:BULLISH. Full BUY alignment.`
        : bearishCount > 0
        ? `2/3 HTFs BULLISH${minority}. BUY allowed with caution — ${levels.find((l) => l.bias === "BEARISH")?.timeframe} is BEARISH.`
        : `2/3 HTFs BULLISH (${levels.find((l) => l.bias !== "BULLISH")?.timeframe} is SIDEWAYS). BUY allowed.`;
  } else if (bearishCount >= 2) {
    agreedDirection = "SELL";
    alignmentCount = bearishCount;
    const minority = bullishCount > 0 ? ` (1 opposing — normal bounce, confidence reduced)` : "";
    reason =
      bearishCount === 3
        ? `ALL 3 HTFs BEARISH — M:BEARISH W:BEARISH D:BEARISH. Full SELL alignment.`
        : bullishCount > 0
        ? `2/3 HTFs BEARISH${minority}. SELL allowed with caution — ${levels.find((l) => l.bias === "BULLISH")?.timeframe} is BULLISH.`
        : `2/3 HTFs BEARISH (${levels.find((l) => l.bias !== "BEARISH")?.timeframe} is SIDEWAYS). SELL allowed.`;
  } else {
    agreedDirection = null;
    alignmentCount = 0;
    reason = `No HTF majority — M:${monthly.bias} W:${weekly.bias} D:${daily.bias}. Market genuinely split or ranging. No trade.`;
  }

  return { monthly, weekly, daily, agreedDirection, alignmentCount, reason };
}

// ─────────────────────────────────────────────
// Entry-TF Analysis
// ─────────────────────────────────────────────

export function detectOrderBlocks(candles: OHLC[], structure: MarketStructure): OrderBlock[] {
  const blocks: OrderBlock[] = [];
  const lastN = candles.slice(-50);

  for (let i = 1; i < lastN.length - 3; i++) {
    const c = lastN[i];
    const next = lastN[i + 1];
    const afterNext = lastN[i + 2];

    if (
      c.close < c.open &&
      next.close > next.open &&
      afterNext.close > afterNext.open &&
      afterNext.close > c.high
    ) {
      const mitigated = lastN.slice(i + 3).some((x) => x.low <= c.close);
      const strength = Math.min(100, ((afterNext.close - c.high) / c.high) * 10_000);
      blocks.push({ direction: "BUY", top: c.open, bottom: c.close, time: c.time, index: i, mitigated, strength });
    }

    if (
      c.close > c.open &&
      next.close < next.open &&
      afterNext.close < afterNext.open &&
      afterNext.close < c.low
    ) {
      const mitigated = lastN.slice(i + 3).some((x) => x.high >= c.close);
      const strength = Math.min(100, ((c.low - afterNext.close) / c.low) * 10_000);
      blocks.push({ direction: "SELL", top: c.close, bottom: c.open, time: c.time, index: i, mitigated, strength });
    }
  }

  return blocks.filter((b) => !b.mitigated);
}

export function detectFairValueGaps(candles: OHLC[]): FairValueGap[] {
  const gaps: FairValueGap[] = [];
  const lastN = candles.slice(-80);

  for (let i = 1; i < lastN.length - 1; i++) {
    const prev = lastN[i - 1];
    const curr = lastN[i];
    const next = lastN[i + 1];

    if (prev.high < next.low && curr.close > curr.open) {
      const filled = lastN.slice(i + 2).some((x) => x.low <= prev.high);
      gaps.push({
        direction: "BUY",
        top: next.low,
        bottom: prev.high,
        timeStart: prev.time,
        timeEnd: next.time,
        filled,
        midpoint: (next.low + prev.high) / 2,
      });
    }

    if (prev.low > next.high && curr.close < curr.open) {
      const filled = lastN.slice(i + 2).some((x) => x.high >= prev.low);
      gaps.push({
        direction: "SELL",
        top: prev.low,
        bottom: next.high,
        timeStart: prev.time,
        timeEnd: next.time,
        filled,
        midpoint: (prev.low + next.high) / 2,
      });
    }
  }

  return gaps.filter((g) => !g.filled);
}

export function detectLiquiditySweeps(candles: OHLC[], structure: MarketStructure): LiquiditySweep[] {
  const sweeps: LiquiditySweep[] = [];
  const lastN = candles.slice(-30);
  const lastCandle = lastN[lastN.length - 1];

  for (const high of structure.currentHighs) {
    const swept = lastN.slice(-5).some((c) => c.high > high);
    const reversed = lastCandle.close < high;
    if (swept && reversed) {
      sweeps.push({
        direction: "SELL",
        level: high,
        time: lastCandle.time,
        strength: Math.min(100, ((lastCandle.high - high) / high) * 10_000 + 50),
      });
    }
  }

  for (const low of structure.currentLows) {
    const swept = lastN.slice(-5).some((c) => c.low < low);
    const reversed = lastCandle.close > low;
    if (swept && reversed) {
      sweeps.push({
        direction: "BUY",
        level: low,
        time: lastCandle.time,
        strength: Math.min(100, ((low - lastCandle.low) / low) * 10_000 + 50),
      });
    }
  }

  return sweeps;
}

/**
 * Kill Zone Clock (ICT-correct windows):
 *   LONDON   07:00–10:00 UTC  = 02:00–05:00 EST
 *   NEW_YORK 12:00–15:00 UTC  = 07:00–10:00 EST
 *   ASIAN    23:00–02:00 UTC  = Tokyo open
 */
export function getCurrentKillZone(): KillZone {
  const now = new Date();
  const h = now.getUTCHours() + now.getUTCMinutes() / 60;
  if (h >= 7 && h < 10) return "LONDON";
  if (h >= 12 && h < 15) return "NEW_YORK";
  if (h >= 23 || h < 2) return "ASIAN";
  return null;
}

/**
 * 07:00–08:30 UTC: Asian-range stop-hunt window before real London direction.
 */
export function isLondonManipulationWindow(): boolean {
  const now = new Date();
  const h = now.getUTCHours() + now.getUTCMinutes() / 60;
  return h >= 7 && h < 8.5;
}

/**
 * Hard news blackout: 30-minute windows around US and EU macro releases.
 */
export function isNewsBlackout(): boolean {
  const now = new Date();
  const h = now.getUTCHours() + now.getUTCMinutes() / 60;
  if (h >= 13.25 && h < 13.75) return true; // US macro (13:30 UTC)
  if (h >= 8.75  && h < 9.25)  return true; // EU macro (09:00 UTC)
  return false;
}

/**
 * Calculate entry, stop-loss, and take-profit levels.
 * Falls back to swing-based stop when no OB/FVG is present.
 */
export function calculateEntryParams(
  direction: Direction,
  orderBlock: OrderBlock | null,
  fvg: FairValueGap | null,
  currentPrice: number,
  minRR: number,
  recentSwingHigh?: number,
  recentSwingLow?: number,
): { entry: number; stop: number; target: number; rr: number } | null {
  let entry = currentPrice;
  let stop: number;
  let target: number;

  if (direction === "BUY") {
    if (orderBlock) {
      entry = (orderBlock.top + orderBlock.bottom) / 2;
      stop = orderBlock.bottom * 0.9995;
    } else if (fvg) {
      entry = fvg.midpoint;
      stop = fvg.bottom * 0.9995;
    } else if (recentSwingLow !== undefined) {
      entry = currentPrice;
      stop = recentSwingLow * 0.9995;
    } else {
      entry = currentPrice;
      stop = currentPrice * 0.995;
    }
    target = entry + Math.abs(entry - stop) * minRR;
  } else {
    if (orderBlock) {
      entry = (orderBlock.top + orderBlock.bottom) / 2;
      stop = orderBlock.top * 1.0005;
    } else if (fvg) {
      entry = fvg.midpoint;
      stop = fvg.top * 1.0005;
    } else if (recentSwingHigh !== undefined) {
      entry = currentPrice;
      stop = recentSwingHigh * 1.0005;
    } else {
      entry = currentPrice;
      stop = currentPrice * 1.005;
    }
    target = entry - Math.abs(stop - entry) * minRR;
  }

  const risk = Math.abs(entry - stop);
  const reward = Math.abs(target - entry);
  return { entry, stop, target, rr: risk > 0 ? reward / risk : 0 };
}

// ─────────────────────────────────────────────
// Confidence Scoring — structure + institutional order flow
// ─────────────────────────────────────────────

/**
 * Confidence is now a two-part score:
 *
 *   STRUCTURE (max ~100)  — the original ICT read: HTF alignment, kill zone,
 *                           order blocks, FVGs, sweeps, BOS/ChoCH.
 *   ORDER FLOW (±25)      — whether real institutional participation confirms
 *                           the structural idea.
 *
 * A structurally perfect setup with order flow leaning the other way is
 * exactly the trade that keeps stopping people out, so aligned flow is the
 * single largest positive adjustment available, and opposed flow is the
 * single largest negative one.
 */
export function calculateConfidence(params: {
  htfAlignmentCount: number;
  htfAllThreeAligned: boolean;
  signalDirection: Direction;
  hasOrderBlock: boolean;
  hasFVG: boolean;
  hasLiquiditySweep: boolean;
  hasBOS: boolean;
  hasChoCH: boolean;
  inKillZone: boolean;
  dailyAligned: boolean;
  h4ConflictsHTF?: boolean;
  inLondonManipulation?: boolean;
  /** Signed order-flow score for this symbol, -100..+100. */
  orderFlowScore?: number;
  /** Absorption event pointing the same way as the signal. */
  absorptionAligned?: boolean;
  /** OI confirms NEW positioning (not covering) in the signal direction. */
  oiConfirms?: boolean;
  /** Institutional-size prints net-aggressing in the signal direction. */
  whaleDeltaAligned?: boolean;
}): number {
  let score = 0;

  // ── Structural component ───────────────────────────────────────────────────
  if (params.htfAllThreeAligned) {
    score += 40;
  } else if (params.htfAlignmentCount >= 2) {
    score += 26;
  }

  if (params.dailyAligned) score += 5;
  if (params.inKillZone) score += 10;
  if (params.hasLiquiditySweep) score += 10;
  if (params.hasOrderBlock) score += 8;
  if (params.hasBOS) score += 7;
  if (params.hasFVG) score += 6;
  if (params.hasChoCH) score += 4;
  if (params.hasOrderBlock && params.hasFVG) score += 3;

  if (params.h4ConflictsHTF) score -= 15;
  if (params.h4ConflictsHTF && params.inLondonManipulation) score -= 10;

  // ── Order-flow component ───────────────────────────────────────────────────
  const flow = params.orderFlowScore ?? 0;
  if (flow !== 0) {
    // Positive when flow agrees with the trade direction.
    const aligned = params.signalDirection === "BUY" ? flow : -flow;
    // ±25 points at |score| = 60, saturating beyond that.
    score += Math.max(-25, Math.min(25, (aligned / 60) * 25));
  }

  // Individual high-conviction confirmations stack a small bonus on top.
  if (params.absorptionAligned) score += 6;
  if (params.oiConfirms) score += 5;
  if (params.whaleDeltaAligned) score += 5;

  return Math.min(100, Math.max(0, Math.round(score)));
}

// ─────────────────────────────────────────────
// Main Entry Point
// ─────────────────────────────────────────────

export interface StrategyConfig {
  useOrderBlocks: boolean;
  useFairValueGaps: boolean;
  useLiquiditySweeps: boolean;
  useBOS: boolean;
  useChoCH: boolean;
  minRR: number;
  minConfidence: number;
  enabledKillZones: string[];

  // ── Institutional order-flow layer ───────────────────────────────────────
  /** Master switch for the order-flow engine. */
  useOrderFlow: boolean;
  /**
   * Hard veto: block the trade when order flow opposes it by at least this
   * much.  25 is a sensible default — it only blocks genuinely one-sided flow.
   */
  orderFlowVetoThreshold: number;
  /**
   * Require order flow to actively agree (score in the trade's direction of at
   * least this magnitude) rather than merely not opposing.  Stricter, fewer
   * trades, materially better win rate on BTC.
   */
  requireFlowConfirmation: boolean;
  minFlowConfirmation: number;
  /**
   * Crypto trades 24/7 — kill zones still matter (that is when desks in London
   * and New York are actually working orders) but they are not mandatory the
   * way they are on FX.  When true, a signal outside a kill zone is allowed
   * through on order-flow strength alone.
   */
  cryptoMode: boolean;
  /** Reject entries when the book is too thin / spread too wide to fill well. */
  maxRelativeSpread: number;
}

export const DEFAULT_STRATEGY_CONFIG: Pick<
  StrategyConfig,
  | "useOrderFlow"
  | "orderFlowVetoThreshold"
  | "requireFlowConfirmation"
  | "minFlowConfirmation"
  | "cryptoMode"
  | "maxRelativeSpread"
> = {
  useOrderFlow: true,
  orderFlowVetoThreshold: 25,
  requireFlowConfirmation: true,
  minFlowConfirmation: 12,
  cryptoMode: true,
  maxRelativeSpread: 0.0008, // 8 bps — comfortably wide for BTC/ETH, tight enough to skip illiquid alts
};

export interface AnalyzeMarketInput {
  symbol: string;
  market: string;
  monthlyCandles: CapitalCandle[];
  weeklyCandles: CapitalCandle[];
  dailyCandles: CapitalCandle[];
  h4Candles: CapitalCandle[];
  h1Candles: CapitalCandle[];
  m15Candles: CapitalCandle[];
  currentBid: number;
  currentOffer: number;
  config: StrategyConfig;
  /** Institutional order-flow context; omit to run structure-only. */
  flow?: OrderFlowContext | null;
}

export async function analyzeMarket(input: AnalyzeMarketInput): Promise<ICTSignal | null> {
  const {
    symbol,
    monthlyCandles,
    weeklyCandles,
    dailyCandles,
    h4Candles,
    h1Candles,
    m15Candles,
    currentBid,
    currentOffer,
    config,
  } = input;
  const flow = config.useOrderFlow ? input.flow ?? null : null;

  try {
    if (monthlyCandles.length < 6 || weeklyCandles.length < 8 || dailyCandles.length < 10) {
      return null;
    }

    // ── STEP 1: Higher-timeframe order flow gate ─────────────────────────────
    const htfFlow = analyzeHTFOrderFlow(monthlyCandles, weeklyCandles, dailyCandles);
    if (!htfFlow.agreedDirection) return null;

    const allowedDirection = htfFlow.agreedDirection;

    const h4OHLC = candlesToOHLC(h4Candles);
    const h1OHLC = candlesToOHLC(h1Candles);
    const m15OHLC = candlesToOHLC(m15Candles);
    if (h4OHLC.length < 10 || h1OHLC.length < 10 || m15OHLC.length < 10) return null;

    const h4Structure = analyzeMarketStructure(h4OHLC);
    const h4ConflictsHTF =
      h4Structure.trend !== "SIDEWAYS" &&
      ((allowedDirection === "BUY" && h4Structure.trend === "BEARISH") ||
        (allowedDirection === "SELL" && h4Structure.trend === "BULLISH"));

    const h1Structure = analyzeMarketStructure(h1OHLC);
    const m15Structure = analyzeMarketStructure(m15OHLC);

    // ── STEP 2: Hard environmental blocks ────────────────────────────────────
    if (isNewsBlackout()) return null;

    // Illiquid book → skip. Slippage on a thin book destroys the edge on a
    // 2R setup faster than any strategy flaw.
    if (flow?.book && flow.book.relativeSpread > config.maxRelativeSpread) {
      return null;
    }

    const killZone = getCurrentKillZone();
    const inKillZone = killZone !== null && config.enabledKillZones.includes(killZone);
    const londonManipulation = isLondonManipulationWindow();

    // On FX-style rules, no kill zone = no trade. In crypto mode we allow it
    // through only when institutional flow is doing the talking instead.
    const flowAligned = flow ? (allowedDirection === "BUY" ? flow.score : -flow.score) : 0;
    if (!inKillZone && !config.cryptoMode) return null;
    if (!inKillZone && config.cryptoMode && flowAligned < 20) return null;

    // ── STEP 3: Order-flow veto ──────────────────────────────────────────────
    // The most important addition. Structure says "buy here"; if real size is
    // aggressively selling into it, that level is being defended, not bought.
    if (flow && flowAligned <= -config.orderFlowVetoThreshold) {
      return null;
    }
    if (flow && config.requireFlowConfirmation && flowAligned < config.minFlowConfirmation) {
      return null;
    }

    // Absorption directly against the trade is an immediate disqualifier.
    if (
      flow?.absorption &&
      flow.absorption.direction !== "NEUTRAL" &&
      ((allowedDirection === "BUY" && flow.absorption.direction === "BEARISH") ||
        (allowedDirection === "SELL" && flow.absorption.direction === "BULLISH"))
    ) {
      return null;
    }

    // ── STEP 4: Entry confluence ─────────────────────────────────────────────
    const allOrderBlocks = config.useOrderBlocks ? detectOrderBlocks(m15OHLC, m15Structure) : [];
    const fvgs = config.useFairValueGaps ? detectFairValueGaps(m15OHLC) : [];
    const liquiditySweeps = config.useLiquiditySweeps
      ? detectLiquiditySweeps(m15OHLC, h1Structure)
      : [];

    const obCutoff = londonManipulation ? new Date(Date.now() - 90 * 60 * 1000) : null;
    const orderBlocks = obCutoff ? allOrderBlocks.filter((ob) => ob.time < obCutoff) : allOrderBlocks;

    const matchingOBs = orderBlocks.filter((ob) => ob.direction === allowedDirection);
    const matchingFVGs = fvgs.filter((fvg) => fvg.direction === allowedDirection);
    const matchingSweeps = liquiditySweeps.filter((s) => s.direction === allowedDirection);
    const hasBOS = config.useBOS && h1Structure.lastBOS?.direction === allowedDirection;
    const hasChoCH = config.useChoCH && m15Structure.lastChoCH?.direction === allowedDirection;

    const hasEntryConfluence =
      matchingOBs.length > 0 ||
      matchingFVGs.length > 0 ||
      matchingSweeps.length > 0 ||
      hasBOS ||
      hasChoCH;
    if (!hasEntryConfluence) return null;

    if (londonManipulation && matchingOBs.length === 0 && matchingFVGs.length === 0) return null;

    const midPrice = (currentBid + currentOffer) / 2;

    const bestOB = matchingOBs.sort((a, b) => b.strength - a.strength)[0] ?? null;
    const bestFVG =
      matchingFVGs.sort(
        (a, b) => Math.abs(a.midpoint - midPrice) - Math.abs(b.midpoint - midPrice),
      )[0] ?? null;

    const recentSwingHigh = h1Structure.swingHighs.slice(-1)[0]?.price;
    const recentSwingLow = h1Structure.swingLows.slice(-1)[0]?.price;

    const baseParams = calculateEntryParams(
      allowedDirection,
      bestOB,
      bestFVG,
      midPrice,
      config.minRR,
      recentSwingHigh,
      recentSwingLow,
    );
    if (!baseParams) return null;

    // ── STEP 5: Liquidity-aware stop and target ──────────────────────────────
    // Structure gives a level; liquidity mapping decides where the stop is
    // actually safe and which pool the market is reaching for.
    let entry = baseParams.entry;
    let stop = baseParams.stop;
    let target = baseParams.target;
    let rr = baseParams.rr;
    let liquidityNote = "";

    if (flow && flow.liquidityPools.length > 0) {
      const refined = refineWithLiquidity({
        direction: allowedDirection,
        entry: baseParams.entry,
        stop: baseParams.stop,
        target: baseParams.target,
        minRR: config.minRR,
        atr: flow.atr,
        pools: flow.liquidityPools,
      });
      if (!refined) return null; // no liquidity-consistent arrangement clears min R:R
      entry = refined.entry;
      stop = refined.stop;
      target = refined.target;
      rr = refined.rr;
      liquidityNote = refined.note;
    }

    if (rr < config.minRR) return null;

    // Never chase: if structure wants an entry far from current price, that is
    // a resting limit order at the zone, not a market fill.
    const distanceFromMid = Math.abs(entry - midPrice) / midPrice;
    const entryStyle: "LIMIT" | "MARKET" = distanceFromMid > 0.0015 ? "LIMIT" : "MARKET";

    // ── STEP 6: Confidence ───────────────────────────────────────────────────
    const absorptionAligned =
      !!flow?.absorption &&
      ((allowedDirection === "BUY" && flow.absorption.direction === "BULLISH") ||
        (allowedDirection === "SELL" && flow.absorption.direction === "BEARISH"));

    const oiConfirms =
      !!flow?.oi &&
      ((allowedDirection === "BUY" && flow.oi.interpretation === "NEW_LONGS") ||
        (allowedDirection === "SELL" && flow.oi.interpretation === "NEW_SHORTS"));

    const whaleDeltaAligned =
      !!flow?.tape &&
      Math.abs(flow.tape.whaleDeltaRatio) > 0.15 &&
      ((allowedDirection === "BUY" && flow.tape.whaleDelta > 0) ||
        (allowedDirection === "SELL" && flow.tape.whaleDelta < 0));

    const confidence = calculateConfidence({
      htfAlignmentCount: htfFlow.alignmentCount,
      htfAllThreeAligned: htfFlow.alignmentCount === 3,
      signalDirection: allowedDirection,
      hasOrderBlock: matchingOBs.length > 0,
      hasFVG: matchingFVGs.length > 0,
      hasLiquiditySweep: matchingSweeps.length > 0,
      hasBOS,
      hasChoCH,
      inKillZone,
      dailyAligned: htfFlow.daily.bias === (allowedDirection === "BUY" ? "BULLISH" : "BEARISH"),
      h4ConflictsHTF,
      inLondonManipulation: londonManipulation,
      orderFlowScore: flow?.score ?? 0,
      absorptionAligned,
      oiConfirms,
      whaleDeltaAligned,
    });

    if (confidence < config.minConfidence) return null;

    // ── STEP 7: Assemble ─────────────────────────────────────────────────────
    const signalTypes: SignalType[] = [];
    if (matchingOBs.length > 0) signalTypes.push("ORDER_BLOCK");
    if (matchingFVGs.length > 0) signalTypes.push("FAIR_VALUE_GAP");
    if (matchingSweeps.length > 0) signalTypes.push("LIQUIDITY_SWEEP");
    if (hasBOS) signalTypes.push("BOS");
    if (hasChoCH) signalTypes.push("CHOCH");

    const signalType: SignalType = signalTypes.length > 1 ? "COMBINED" : signalTypes[0] ?? "BOS";

    const notesParts = [
      htfFlow.reason,
      `H4: ${h4Structure.trend}${h4ConflictsHTF ? " (conflicts HTF)" : ""}`,
      londonManipulation ? "London manipulation window" : null,
      killZone ? `Kill zone: ${killZone}` : "Outside kill zone (crypto mode, flow-led)",
      flow ? `Flow ${flow.score > 0 ? "+" : ""}${flow.score} (${flow.bias})` : "Order flow disabled",
      absorptionAligned ? "Absorption confirms" : null,
      oiConfirms ? "OI confirms new positioning" : null,
      whaleDeltaAligned ? "Whale prints aligned" : null,
      liquidityNote || null,
      `Entry: ${entryStyle}`,
    ].filter(Boolean);

    return {
      direction: allowedDirection,
      signalType,
      timeframe: "M15",
      entryPrice: entry,
      stopLoss: stop,
      takeProfit: target,
      confidence,
      killZone,
      notes: notesParts.join(" | "),
      htfBias: allowedDirection === "BUY" ? "BULLISH" : "BEARISH",
      structureContext: [
        htfFlow.monthly.summary,
        htfFlow.weekly.summary,
        htfFlow.daily.summary,
      ].join(" || "),
      orderFlowScore: flow?.score ?? 0,
      orderFlowBias: flow?.bias ?? "NEUTRAL",
      orderFlowNotes: flow ? flow.notes.join(" | ") : "",
      riskReward: rr,
      entryStyle,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`ICT analyzeMarket(${symbol}): ${msg}`);
  }
}
