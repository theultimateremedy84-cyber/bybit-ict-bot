/**
 * Institutional Order Flow Engine
 * ================================
 *
 * This module adds the "who is actually transacting, and where" layer on top of
 * the ICT / Smart-Money structural read.  ICT tells you WHERE price is likely to
 * react; order flow tells you WHETHER real size is participating there.
 *
 * Everything here is derived from Bybit V5 public market data — no paid feed:
 *
 *   1. ORDER BOOK IMBALANCE      /v5/market/orderbook       (depth 200)
 *      Resting liquidity skew around mid, plus detection of genuine
 *      liquidity walls (levels holding >3x the mean level size).
 *
 *   2. TAPE / AGGRESSION DELTA   /v5/market/recent-trade    (1000 prints)
 *      True aggressor-side delta (market buys vs market sells), whale-print
 *      delta (institutional-size clips) and buy/sell pressure ratio.
 *      This is the closest retail-accessible proxy to CVD.
 *
 *   3. VOLUME PROFILE            5m klines
 *      POC, Value Area High/Low (70%), High/Low Volume Nodes.
 *      Institutions execute around value; LVNs are where price travels fast.
 *
 *   4. SESSION VWAP + BANDS      5m klines
 *      VWAP is the actual institutional execution benchmark.  Price above
 *      VWAP = passive buyers in control; 2-sigma bands mark exhaustion.
 *
 *   5. OPEN INTEREST DELTA       /v5/market/open-interest
 *      OI + price combination separates NEW positioning from covering:
 *        price up   + OI up   → new longs      (real initiative buying)
 *        price up   + OI down → short covering (weak, fades)
 *        price down + OI up   → new shorts     (real initiative selling)
 *        price down + OI down → long liquidation
 *
 *   6. FUNDING RATE              /v5/market/funding/history
 *      Crowding gauge.  Extreme positive funding = over-levered longs paying
 *      to hold → contrarian bearish, and vice-versa.
 *
 *   7. RETAIL POSITIONING        /v5/market/account-ratio
 *      Long/short account ratio.  Extremes are faded — banks take the other
 *      side of crowded retail books.
 *
 *   8. ABSORPTION DETECTION      klines
 *      Heavy volume producing very little range = passive size absorbing the
 *      aggressors.  The single highest-value order-flow tell for reversals.
 *
 *   9. LIQUIDITY POOLS
 *      Equal highs/lows, prior-day/prior-week high/low, session extremes.
 *      These are the magnets institutions target for fills — used both as
 *      take-profit destinations and as stop-placement no-go zones.
 *
 * The engine folds all of this into a single signed score (-100..+100) plus a
 * structured context object that the ICT strategy consumes to confirm, boost,
 * penalise or veto a structural signal.
 */

import type { BybitApiClient, BybitCandle, BybitOrderBook, BybitPublicTrade } from "./bybitApi";
import { logger } from "./logger";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type FlowBias = "BULLISH" | "BEARISH" | "NEUTRAL";

export interface BookImbalance {
  /** Total bid size within the depth window (base currency). */
  bidDepth: number;
  /** Total ask size within the depth window (base currency). */
  askDepth: number;
  /** (bid - ask) / (bid + ask)  →  -1 .. +1 */
  imbalance: number;
  /** Largest resting bid cluster below price. */
  bidWall: { price: number; size: number } | null;
  /** Largest resting ask cluster above price. */
  askWall: { price: number; size: number } | null;
  /** Half-spread as a fraction of mid — liquidity/quality gate. */
  relativeSpread: number;
  mid: number;
}

export interface TapeStats {
  /** Aggressive buy volume (taker bought). */
  buyVolume: number;
  /** Aggressive sell volume (taker sold). */
  sellVolume: number;
  /** buyVolume - sellVolume, in base currency. */
  delta: number;
  /** delta normalised by total volume, -1 .. +1 */
  deltaRatio: number;
  /** Delta restricted to institutional-size prints only. */
  whaleDelta: number;
  whaleDeltaRatio: number;
  /** Notional threshold (USDT) used to classify a print as institutional. */
  whaleThreshold: number;
  tradeCount: number;
  /** Average notional per print — rising average = size stepping in. */
  avgNotional: number;
}

export interface VolumeNode {
  price: number;
  volume: number;
}

export interface VolumeProfile {
  /** Point of Control — the price with the most traded volume. */
  poc: number;
  /** Value Area High (70% of volume). */
  vah: number;
  /** Value Area Low. */
  val: number;
  /** High Volume Nodes — acceptance / magnet zones. */
  hvns: VolumeNode[];
  /** Low Volume Nodes — rejection / fast-travel zones. */
  lvns: VolumeNode[];
  binSize: number;
}

export interface VwapStats {
  vwap: number;
  upper1: number;
  lower1: number;
  upper2: number;
  lower2: number;
  /** Price distance from VWAP in standard deviations. */
  zScore: number;
  priceAbove: boolean;
}

export type OiInterpretation =
  | "NEW_LONGS"
  | "NEW_SHORTS"
  | "SHORT_COVERING"
  | "LONG_LIQUIDATION"
  | "FLAT";

export interface OpenInterestStats {
  current: number;
  previous: number;
  changePct: number;
  pricePct: number;
  interpretation: OiInterpretation;
}

export interface FundingStats {
  rate: number;
  annualisedPct: number;
  /** true when funding is far enough from neutral to be a crowding signal. */
  extreme: boolean;
  /** Direction the crowd is leaning. */
  crowdedSide: "LONG" | "SHORT" | "NONE";
}

export interface PositioningStats {
  longAccountPct: number;
  shortAccountPct: number;
  ratio: number;
  extreme: boolean;
  crowdedSide: "LONG" | "SHORT" | "NONE";
}

export interface AbsorptionEvent {
  direction: FlowBias;
  price: number;
  /** Volume relative to the rolling average (e.g. 3.2 = 320% of normal). */
  volumeRatio: number;
  /** Range relative to the rolling average range. */
  rangeRatio: number;
  note: string;
}

export type PoolKind =
  | "EQUAL_HIGHS"
  | "EQUAL_LOWS"
  | "PREV_DAY_HIGH"
  | "PREV_DAY_LOW"
  | "PREV_WEEK_HIGH"
  | "PREV_WEEK_LOW"
  | "SESSION_HIGH"
  | "SESSION_LOW"
  | "BOOK_WALL";

export interface LiquidityPool {
  price: number;
  kind: PoolKind;
  side: "ABOVE" | "BELOW";
  /** 0..100 — how much resting liquidity this level is likely to hold. */
  strength: number;
}

export interface OrderFlowContext {
  symbol: string;
  /** Signed conviction, -100 (institutional selling) .. +100 (institutional buying). */
  score: number;
  bias: FlowBias;
  book: BookImbalance | null;
  tape: TapeStats | null;
  profile: VolumeProfile | null;
  vwap: VwapStats | null;
  oi: OpenInterestStats | null;
  funding: FundingStats | null;
  positioning: PositioningStats | null;
  absorption: AbsorptionEvent | null;
  liquidityPools: LiquidityPool[];
  /** Rolling ATR on the entry timeframe — used for volatility-scaled stops. */
  atr: number;
  notes: string[];
  /** Human-readable one-liner for the signal record / dashboard. */
  summary: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────────────

const mid = (c: BybitCandle) => ({
  time: new Date(c.snapshotTime).getTime(),
  open: c.openPrice.bid,
  high: c.highPrice.bid,
  low: c.lowPrice.bid,
  close: c.closePrice.bid,
  volume: c.lastTradedVolume,
});

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)));
  return sorted[idx];
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((s, v) => s + v, 0) / values.length;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Order book imbalance
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Measure resting liquidity skew within `windowPct` of mid price.
 *
 * Only the near book matters — far-away levels are routinely pulled and are a
 * common spoofing surface.  A 0.5% window on BTC is roughly where genuine
 * passive interest sits.
 */
export function analyseOrderBook(book: BybitOrderBook, windowPct = 0.005): BookImbalance | null {
  const bestBid = book.bids[0]?.[0];
  const bestAsk = book.asks[0]?.[0];
  if (!bestBid || !bestAsk) return null;

  const midPrice = (bestBid + bestAsk) / 2;
  const lo = midPrice * (1 - windowPct);
  const hi = midPrice * (1 + windowPct);

  const bidsIn = book.bids.filter(([p]) => p >= lo);
  const asksIn = book.asks.filter(([p]) => p <= hi);

  const bidDepth = bidsIn.reduce((s, [, q]) => s + q, 0);
  const askDepth = asksIn.reduce((s, [, q]) => s + q, 0);
  const total = bidDepth + askDepth;

  const meanBid = mean(bidsIn.map(([, q]) => q));
  const meanAsk = mean(asksIn.map(([, q]) => q));

  const bidWallLevel = [...bidsIn].sort((a, b) => b[1] - a[1])[0];
  const askWallLevel = [...asksIn].sort((a, b) => b[1] - a[1])[0];

  return {
    bidDepth,
    askDepth,
    imbalance: total > 0 ? (bidDepth - askDepth) / total : 0,
    // A "wall" only counts when it is 3x the average level in the window.
    bidWall:
      bidWallLevel && meanBid > 0 && bidWallLevel[1] > meanBid * 3
        ? { price: bidWallLevel[0], size: bidWallLevel[1] }
        : null,
    askWall:
      askWallLevel && meanAsk > 0 && askWallLevel[1] > meanAsk * 3
        ? { price: askWallLevel[0], size: askWallLevel[1] }
        : null,
    relativeSpread: (bestAsk - bestBid) / midPrice,
    mid: midPrice,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Tape / aggression delta
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute aggressor-side delta from the public trade tape.
 *
 * Bybit reports the taker side on every print, so this is a genuine delta, not
 * a tick-rule approximation.  Whale delta isolates prints above the 90th
 * percentile notional — that subset is where desk/algo activity shows up.
 */
export function analyseTape(trades: BybitPublicTrade[]): TapeStats | null {
  if (trades.length === 0) return null;

  const notionals = trades.map((t) => t.price * t.size);
  // Institutional clip threshold: 90th percentile, floored at 25k USDT so a
  // quiet tape on an alt doesn't classify retail prints as whales.
  const whaleThreshold = Math.max(25_000, percentile(notionals, 90));

  let buyVolume = 0;
  let sellVolume = 0;
  let whaleBuy = 0;
  let whaleSell = 0;

  for (const t of trades) {
    const notional = t.price * t.size;
    if (t.side === "Buy") {
      buyVolume += t.size;
      if (notional >= whaleThreshold) whaleBuy += t.size;
    } else {
      sellVolume += t.size;
      if (notional >= whaleThreshold) whaleSell += t.size;
    }
  }

  const total = buyVolume + sellVolume;
  const whaleTotal = whaleBuy + whaleSell;

  return {
    buyVolume,
    sellVolume,
    delta: buyVolume - sellVolume,
    deltaRatio: total > 0 ? (buyVolume - sellVolume) / total : 0,
    whaleDelta: whaleBuy - whaleSell,
    whaleDeltaRatio: whaleTotal > 0 ? (whaleBuy - whaleSell) / whaleTotal : 0,
    whaleThreshold,
    tradeCount: trades.length,
    avgNotional: mean(notionals),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Volume profile
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a volume profile by distributing each candle's volume evenly across the
 * price bins it spans.  With 5m candles over ~24h this is a close approximation
 * of a true tick profile and is what most desk tooling shows.
 */
export function buildVolumeProfile(candles: BybitCandle[], bins = 60): VolumeProfile | null {
  if (candles.length < 10) return null;
  const rows = candles.map(mid);

  const hi = Math.max(...rows.map((r) => r.high));
  const lo = Math.min(...rows.map((r) => r.low));
  if (!(hi > lo)) return null;

  const binSize = (hi - lo) / bins;
  const buckets = new Array<number>(bins).fill(0);

  for (const r of rows) {
    const startBin = Math.max(0, Math.floor((r.low - lo) / binSize));
    const endBin = Math.min(bins - 1, Math.floor((r.high - lo) / binSize));
    const span = endBin - startBin + 1;
    const perBin = r.volume / span;
    for (let b = startBin; b <= endBin; b++) buckets[b] += perBin;
  }

  const priceOf = (b: number) => lo + binSize * (b + 0.5);

  let pocBin = 0;
  for (let b = 1; b < bins; b++) if (buckets[b] > buckets[pocBin]) pocBin = b;

  // Expand outward from the POC until 70% of total volume is captured.
  const totalVolume = buckets.reduce((s, v) => s + v, 0);
  const target = totalVolume * 0.7;
  let acc = buckets[pocBin];
  let up = pocBin;
  let down = pocBin;
  while (acc < target && (up < bins - 1 || down > 0)) {
    const upVal = up < bins - 1 ? buckets[up + 1] : -1;
    const downVal = down > 0 ? buckets[down - 1] : -1;
    if (upVal >= downVal) {
      up += 1;
      acc += Math.max(0, upVal);
    } else {
      down -= 1;
      acc += Math.max(0, downVal);
    }
  }

  const avgBucket = totalVolume / bins;
  const nodes: VolumeNode[] = buckets.map((v, b) => ({ price: priceOf(b), volume: v }));

  return {
    poc: priceOf(pocBin),
    vah: priceOf(up),
    val: priceOf(down),
    hvns: nodes.filter((n) => n.volume > avgBucket * 1.5).sort((a, b) => b.volume - a.volume).slice(0, 5),
    lvns: nodes.filter((n) => n.volume > 0 && n.volume < avgBucket * 0.4).slice(0, 8),
    binSize,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Session VWAP + standard deviation bands
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Session-anchored VWAP (anchored to 00:00 UTC) with 1 and 2 sigma bands.
 * Falls back to the full candle set when the session has just rolled over.
 */
export function computeSessionVwap(candles: BybitCandle[], currentPrice: number): VwapStats | null {
  if (candles.length === 0) return null;

  const sessionStart = new Date();
  sessionStart.setUTCHours(0, 0, 0, 0);

  let rows = candles.map(mid).filter((r) => r.time >= sessionStart.getTime());
  if (rows.length < 6) rows = candles.map(mid).slice(-48);
  if (rows.length === 0) return null;

  let pvSum = 0;
  let vSum = 0;
  for (const r of rows) {
    const typical = (r.high + r.low + r.close) / 3;
    pvSum += typical * r.volume;
    vSum += r.volume;
  }
  if (vSum <= 0) return null;
  const vwap = pvSum / vSum;

  let varSum = 0;
  for (const r of rows) {
    const typical = (r.high + r.low + r.close) / 3;
    varSum += r.volume * (typical - vwap) ** 2;
  }
  const sigma = Math.sqrt(varSum / vSum);

  return {
    vwap,
    upper1: vwap + sigma,
    lower1: vwap - sigma,
    upper2: vwap + sigma * 2,
    lower2: vwap - sigma * 2,
    zScore: sigma > 0 ? (currentPrice - vwap) / sigma : 0,
    priceAbove: currentPrice > vwap,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Absorption
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Absorption = abnormally high volume producing abnormally small range.
 * Aggressive orders are being soaked up by passive size — the hallmark of an
 * institution filling against the crowd.  Direction is inferred from where the
 * candle closed inside its own range.
 */
export function detectAbsorption(candles: BybitCandle[], lookback = 40): AbsorptionEvent | null {
  const rows = candles.map(mid).slice(-lookback);
  if (rows.length < 15) return null;

  const history = rows.slice(0, -3);
  const avgVolume = mean(history.map((r) => r.volume));
  const avgRange = mean(history.map((r) => r.high - r.low));
  if (avgVolume <= 0 || avgRange <= 0) return null;

  // Scan the last three closed candles, newest first.
  for (const r of rows.slice(-3).reverse()) {
    const range = r.high - r.low;
    const volumeRatio = r.volume / avgVolume;
    const rangeRatio = range / avgRange;

    if (volumeRatio < 1.8 || rangeRatio > 0.8 || range <= 0) continue;

    const closePosition = (r.close - r.low) / range; // 0 = closed on low, 1 = on high

    if (closePosition >= 0.6) {
      return {
        direction: "BULLISH",
        price: r.low,
        volumeRatio,
        rangeRatio,
        note: `Sell absorption at ${r.low.toFixed(2)} — ${volumeRatio.toFixed(1)}x volume, ${(rangeRatio * 100).toFixed(0)}% of normal range, closed in upper third`,
      };
    }
    if (closePosition <= 0.4) {
      return {
        direction: "BEARISH",
        price: r.high,
        volumeRatio,
        rangeRatio,
        note: `Buy absorption at ${r.high.toFixed(2)} — ${volumeRatio.toFixed(1)}x volume, ${(rangeRatio * 100).toFixed(0)}% of normal range, closed in lower third`,
      };
    }
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Liquidity pools
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Locate the resting-stop clusters institutions hunt for fills:
 *   - equal highs / equal lows (within a tolerance band)
 *   - prior day and prior week extremes
 *   - current session extremes
 *   - genuine book walls
 */
export function findLiquidityPools(params: {
  m15Candles: BybitCandle[];
  dailyCandles: BybitCandle[];
  currentPrice: number;
  book: BookImbalance | null;
  tolerancePct?: number;
}): LiquidityPool[] {
  const { m15Candles, dailyCandles, currentPrice, book } = params;
  const tolerance = params.tolerancePct ?? 0.0015;
  const pools: LiquidityPool[] = [];

  const push = (price: number, kind: PoolKind, strength: number) => {
    if (!Number.isFinite(price) || price <= 0) return;
    pools.push({ price, kind, side: price > currentPrice ? "ABOVE" : "BELOW", strength });
  };

  const rows = m15Candles.map(mid).slice(-160);

  // Equal highs / equal lows — clusters of touches inside the tolerance band.
  const highs = rows.map((r) => r.high);
  const lows = rows.map((r) => r.low);

  const cluster = (values: number[], kind: PoolKind) => {
    const used = new Set<number>();
    for (let i = 0; i < values.length; i++) {
      if (used.has(i)) continue;
      const group = [values[i]];
      for (let j = i + 1; j < values.length; j++) {
        if (used.has(j)) continue;
        if (Math.abs(values[j] - values[i]) / values[i] <= tolerance) {
          group.push(values[j]);
          used.add(j);
        }
      }
      if (group.length >= 2) {
        push(mean(group), kind, Math.min(100, 40 + group.length * 12));
      }
    }
  };

  cluster(highs, "EQUAL_HIGHS");
  cluster(lows, "EQUAL_LOWS");

  // Prior day / prior week extremes.
  const daily = dailyCandles.map(mid);
  const prevDay = daily[daily.length - 2];
  if (prevDay) {
    push(prevDay.high, "PREV_DAY_HIGH", 75);
    push(prevDay.low, "PREV_DAY_LOW", 75);
  }
  const prevWeek = daily.slice(-14, -7);
  if (prevWeek.length > 0) {
    push(Math.max(...prevWeek.map((d) => d.high)), "PREV_WEEK_HIGH", 85);
    push(Math.min(...prevWeek.map((d) => d.low)), "PREV_WEEK_LOW", 85);
  }

  // Current session extremes.
  const sessionStart = new Date();
  sessionStart.setUTCHours(0, 0, 0, 0);
  const session = rows.filter((r) => r.time >= sessionStart.getTime());
  if (session.length > 3) {
    push(Math.max(...session.map((r) => r.high)), "SESSION_HIGH", 60);
    push(Math.min(...session.map((r) => r.low)), "SESSION_LOW", 60);
  }

  // Book walls are real, currently-resting liquidity.
  if (book?.bidWall) push(book.bidWall.price, "BOOK_WALL", 70);
  if (book?.askWall) push(book.askWall.price, "BOOK_WALL", 70);

  // De-duplicate levels that land on top of each other, keeping the strongest.
  const deduped: LiquidityPool[] = [];
  for (const pool of pools.sort((a, b) => b.strength - a.strength)) {
    if (deduped.some((d) => Math.abs(d.price - pool.price) / pool.price <= tolerance)) continue;
    deduped.push(pool);
  }

  return deduped.sort((a, b) => Math.abs(a.price - currentPrice) - Math.abs(b.price - currentPrice));
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. ATR
// ─────────────────────────────────────────────────────────────────────────────

/** Wilder-style ATR used for volatility-scaled stops and targets. */
export function computeATR(candles: BybitCandle[], period = 14): number {
  const rows = candles.map(mid);
  if (rows.length < period + 1) return 0;

  const trs: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    const prevClose = rows[i - 1].close;
    trs.push(
      Math.max(
        rows[i].high - rows[i].low,
        Math.abs(rows[i].high - prevClose),
        Math.abs(rows[i].low - prevClose),
      ),
    );
  }
  return mean(trs.slice(-period));
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. Derived interpretations
// ─────────────────────────────────────────────────────────────────────────────

export function interpretOpenInterest(
  currentOi: number,
  previousOi: number,
  pricePct: number,
): OpenInterestStats {
  const changePct = previousOi > 0 ? ((currentOi - previousOi) / previousOi) * 100 : 0;

  let interpretation: OiInterpretation = "FLAT";
  const oiMoved = Math.abs(changePct) >= 0.5;
  const priceMoved = Math.abs(pricePct) >= 0.2;

  if (oiMoved && priceMoved) {
    if (pricePct > 0 && changePct > 0) interpretation = "NEW_LONGS";
    else if (pricePct > 0 && changePct < 0) interpretation = "SHORT_COVERING";
    else if (pricePct < 0 && changePct > 0) interpretation = "NEW_SHORTS";
    else interpretation = "LONG_LIQUIDATION";
  }

  return { current: currentOi, previous: previousOi, changePct, pricePct, interpretation };
}

export function interpretFunding(rate: number): FundingStats {
  // Bybit funds every 8h → 3 payments/day.
  const annualisedPct = rate * 3 * 365 * 100;
  const extreme = Math.abs(annualisedPct) >= 30; // ~0.0274% per interval
  return {
    rate,
    annualisedPct,
    extreme,
    crowdedSide: !extreme ? "NONE" : annualisedPct > 0 ? "LONG" : "SHORT",
  };
}

export function interpretPositioning(longPct: number, shortPct: number): PositioningStats {
  const ratio = shortPct > 0 ? longPct / shortPct : 0;
  const extreme = ratio >= 2 || (ratio > 0 && ratio <= 0.5);
  return {
    longAccountPct: longPct,
    shortAccountPct: shortPct,
    ratio,
    extreme,
    crowdedSide: !extreme ? "NONE" : ratio >= 2 ? "LONG" : "SHORT",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. Composite scoring
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Weights are deliberately ordered by signal reliability:
 *   whale delta > absorption > OI positioning > book imbalance > raw delta >
 *   VWAP location > value-area location > crowding fades.
 */
const WEIGHTS = {
  whaleDelta: 22,
  tapeDelta: 14,
  absorption: 18,
  openInterest: 16,
  bookImbalance: 12,
  vwap: 8,
  valueArea: 6,
  fundingFade: 6,
  positioningFade: 4,
} as const;

export function scoreOrderFlow(ctx: Omit<OrderFlowContext, "score" | "bias" | "summary" | "notes">): {
  score: number;
  notes: string[];
} {
  let score = 0;
  const notes: string[] = [];

  // ── Tape ───────────────────────────────────────────────────────────────────
  if (ctx.tape) {
    const { deltaRatio, whaleDeltaRatio, whaleDelta } = ctx.tape;

    score += Math.max(-1, Math.min(1, deltaRatio * 2.5)) * WEIGHTS.tapeDelta;
    notes.push(
      `Tape delta ${(deltaRatio * 100).toFixed(1)}% ${deltaRatio > 0 ? "buy" : "sell"}-side aggression`,
    );

    if (Math.abs(whaleDelta) > 0) {
      score += Math.max(-1, Math.min(1, whaleDeltaRatio * 2)) * WEIGHTS.whaleDelta;
      notes.push(
        `Institutional prints (>${Math.round(ctx.tape.whaleThreshold / 1000)}k USDT) net ${whaleDelta > 0 ? "BUYING" : "SELLING"} (${(whaleDeltaRatio * 100).toFixed(0)}%)`,
      );
    }
  }

  // ── Absorption ─────────────────────────────────────────────────────────────
  if (ctx.absorption) {
    const magnitude = Math.min(1, ctx.absorption.volumeRatio / 3);
    score += (ctx.absorption.direction === "BULLISH" ? 1 : -1) * magnitude * WEIGHTS.absorption;
    notes.push(ctx.absorption.note);
  }

  // ── Open interest ──────────────────────────────────────────────────────────
  if (ctx.oi) {
    const magnitude = Math.min(1, Math.abs(ctx.oi.changePct) / 3);
    switch (ctx.oi.interpretation) {
      case "NEW_LONGS":
        score += magnitude * WEIGHTS.openInterest;
        notes.push(`OI +${ctx.oi.changePct.toFixed(2)}% with price up — new longs, initiative buying`);
        break;
      case "NEW_SHORTS":
        score -= magnitude * WEIGHTS.openInterest;
        notes.push(`OI +${ctx.oi.changePct.toFixed(2)}% with price down — new shorts, initiative selling`);
        break;
      case "SHORT_COVERING":
        // A rally on falling OI is not real demand — damp any bullish read.
        score -= magnitude * WEIGHTS.openInterest * 0.5;
        notes.push(`OI ${ctx.oi.changePct.toFixed(2)}% with price up — short covering, rally lacks new demand`);
        break;
      case "LONG_LIQUIDATION":
        score += magnitude * WEIGHTS.openInterest * 0.5;
        notes.push(`OI ${ctx.oi.changePct.toFixed(2)}% with price down — long liquidation, selling is forced not initiative`);
        break;
      default:
        break;
    }
  }

  // ── Book ───────────────────────────────────────────────────────────────────
  if (ctx.book) {
    score += Math.max(-1, Math.min(1, ctx.book.imbalance * 2)) * WEIGHTS.bookImbalance;
    notes.push(
      `Book ${ctx.book.imbalance >= 0 ? "bid" : "ask"}-heavy ${(Math.abs(ctx.book.imbalance) * 100).toFixed(0)}% within 0.5% of mid`,
    );
    if (ctx.book.bidWall) notes.push(`Bid wall @ ${ctx.book.bidWall.price}`);
    if (ctx.book.askWall) notes.push(`Ask wall @ ${ctx.book.askWall.price}`);
  }

  // ── VWAP ───────────────────────────────────────────────────────────────────
  if (ctx.vwap) {
    const z = ctx.vwap.zScore;
    if (Math.abs(z) >= 2) {
      // Beyond 2 sigma is statistically stretched — mean reversion pressure.
      score += (z > 0 ? -1 : 1) * WEIGHTS.vwap;
      notes.push(`Price ${z.toFixed(1)}σ from session VWAP — stretched, reversion risk`);
    } else {
      score += (z > 0 ? 1 : -1) * Math.min(1, Math.abs(z)) * WEIGHTS.vwap * 0.6;
      notes.push(`Price ${z >= 0 ? "above" : "below"} session VWAP (${z.toFixed(2)}σ)`);
    }
  }

  // ── Value area ─────────────────────────────────────────────────────────────
  if (ctx.profile && ctx.book) {
    const price = ctx.book.mid;
    if (price > ctx.profile.vah) {
      score += WEIGHTS.valueArea;
      notes.push(`Price accepted above value area (VAH ${ctx.profile.vah.toFixed(2)})`);
    } else if (price < ctx.profile.val) {
      score -= WEIGHTS.valueArea;
      notes.push(`Price accepted below value area (VAL ${ctx.profile.val.toFixed(2)})`);
    } else {
      notes.push(`Price inside value area — balanced auction, POC ${ctx.profile.poc.toFixed(2)}`);
    }
  }

  // ── Crowding fades ─────────────────────────────────────────────────────────
  if (ctx.funding?.extreme) {
    score += (ctx.funding.crowdedSide === "LONG" ? -1 : 1) * WEIGHTS.fundingFade;
    notes.push(
      `Funding ${ctx.funding.annualisedPct.toFixed(0)}% annualised — crowded ${ctx.funding.crowdedSide.toLowerCase()}s, fade risk`,
    );
  }

  if (ctx.positioning?.extreme) {
    score += (ctx.positioning.crowdedSide === "LONG" ? -1 : 1) * WEIGHTS.positioningFade;
    notes.push(
      `Retail L/S ratio ${ctx.positioning.ratio.toFixed(2)} — crowded ${ctx.positioning.crowdedSide.toLowerCase()}s`,
    );
  }

  return { score: Math.max(-100, Math.min(100, Math.round(score))), notes };
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. Public builder
// ─────────────────────────────────────────────────────────────────────────────

export interface BuildOrderFlowOptions {
  /** 5-minute candles (≈ last 24h) used for profile, VWAP and absorption. */
  m5Candles: BybitCandle[];
  /** 15-minute candles used for liquidity pools and ATR. */
  m15Candles: BybitCandle[];
  /** Daily candles used for prior-day / prior-week pools. */
  dailyCandles: BybitCandle[];
  currentPrice: number;
  /** Set false to skip the account-ratio call on symbols that don't support it. */
  includePositioning?: boolean;
}

/**
 * Fetch every order-flow input in parallel and fold them into one context.
 * Any individual failure degrades gracefully — the field becomes null and its
 * weight simply drops out of the score.
 */
export async function buildOrderFlowContext(
  client: BybitApiClient,
  symbol: string,
  opts: BuildOrderFlowOptions,
): Promise<OrderFlowContext> {
  const { m5Candles, m15Candles, dailyCandles, currentPrice } = opts;

  const [bookRaw, tradesRaw, oiRaw, fundingRaw, ratioRaw] = await Promise.all([
    client.getOrderBook(symbol, 200).catch(() => null),
    client.getRecentTrades(symbol, 1000).catch(() => []),
    client.getOpenInterestHistory(symbol, "5min", 60).catch(() => []),
    client.getFundingRate(symbol).catch(() => null),
    opts.includePositioning === false
      ? Promise.resolve(null)
      : client.getLongShortRatio(symbol, "1h", 2).catch(() => null),
  ]);

  const book = bookRaw ? analyseOrderBook(bookRaw) : null;
  const tape = analyseTape(tradesRaw);
  const profile = buildVolumeProfile(m5Candles);
  const vwap = computeSessionVwap(m5Candles, currentPrice);
  const absorption = detectAbsorption(m15Candles);
  const atr = computeATR(m15Candles, 14);

  // Open interest change measured over the last ~1h (12 x 5min buckets),
  // paired with the price change over the same window.
  let oi: OpenInterestStats | null = null;
  if (oiRaw.length >= 13) {
    const current = oiRaw[oiRaw.length - 1].openInterest;
    const previous = oiRaw[oiRaw.length - 13].openInterest;
    const m5 = m5Candles.map(mid);
    const priceThen = m5.length >= 13 ? m5[m5.length - 13].close : currentPrice;
    const pricePct = priceThen > 0 ? ((currentPrice - priceThen) / priceThen) * 100 : 0;
    oi = interpretOpenInterest(current, previous, pricePct);
  }

  const funding = fundingRaw !== null ? interpretFunding(fundingRaw) : null;
  const positioning = ratioRaw ? interpretPositioning(ratioRaw.buyRatio * 100, ratioRaw.sellRatio * 100) : null;

  const liquidityPools = findLiquidityPools({
    m15Candles,
    dailyCandles,
    currentPrice,
    book,
  });

  const partial = {
    symbol,
    book,
    tape,
    profile,
    vwap,
    oi,
    funding,
    positioning,
    absorption,
    liquidityPools,
    atr,
  };

  const { score, notes } = scoreOrderFlow(partial);

  const bias: FlowBias = score >= 15 ? "BULLISH" : score <= -15 ? "BEARISH" : "NEUTRAL";

  const summary = `Order flow ${bias} (${score > 0 ? "+" : ""}${score}) — ${notes.slice(0, 3).join("; ")}`;

  logger.debug({ symbol, score, bias }, "Order flow context built");

  return { ...partial, score, bias, notes, summary };
}

// ─────────────────────────────────────────────────────────────────────────────
// 11. Liquidity-aware target and stop refinement
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Replace a naive "entry ± R multiple" target with the nearest genuine
 * liquidity pool in the trade's direction, and push the stop just past the
 * opposing pool (plus an ATR buffer) so it sits behind the stop-hunt zone
 * rather than inside it.
 *
 * Returns null when no arrangement satisfies the minimum R:R — that is an
 * intentional no-trade, not a failure.
 */
export function refineWithLiquidity(params: {
  direction: "BUY" | "SELL";
  entry: number;
  stop: number;
  target: number;
  minRR: number;
  atr: number;
  pools: LiquidityPool[];
}): { entry: number; stop: number; target: number; rr: number; note: string } | null {
  const { direction, entry, minRR, atr, pools } = params;
  const isBuy = direction === "BUY";
  const notes: string[] = [];

  let stop = params.stop;
  let target = params.target;

  // ── Stop: sit beyond the nearest opposing pool, never in front of it ───────
  const opposing = pools
    .filter((p) => (isBuy ? p.price < entry : p.price > entry))
    .filter((p) => Math.abs(p.price - entry) / entry <= 0.03) // within 3%
    .sort((a, b) => Math.abs(a.price - entry) - Math.abs(b.price - entry));

  const nearestOpposing = opposing[0];
  if (nearestOpposing) {
    const buffer = Math.max(atr * 0.25, entry * 0.0005);
    const beyondPool = isBuy ? nearestOpposing.price - buffer : nearestOpposing.price + buffer;
    // Only widen — never tighten a structurally valid stop.
    if (isBuy ? beyondPool < stop : beyondPool > stop) {
      stop = beyondPool;
      notes.push(`stop moved beyond ${nearestOpposing.kind.toLowerCase().replace(/_/g, " ")} @ ${nearestOpposing.price.toFixed(2)}`);
    }
  }

  // Volatility floor — a stop inside 0.75 ATR is noise-range on crypto.
  const minDistance = atr * 0.75;
  if (atr > 0 && Math.abs(entry - stop) < minDistance) {
    stop = isBuy ? entry - minDistance : entry + minDistance;
    notes.push(`stop widened to 0.75 ATR volatility floor`);
  }

  const risk = Math.abs(entry - stop);
  if (risk <= 0) return null;

  // ── Target: aim at the pool the market is actually reaching for ────────────
  const inDirection = pools
    .filter((p) => (isBuy ? p.price > entry : p.price < entry))
    .filter((p) => p.strength >= 60)
    .sort((a, b) => Math.abs(a.price - entry) - Math.abs(b.price - entry));

  // Prefer the closest strong pool that still clears the minimum R:R.
  const viable = inDirection.find((p) => Math.abs(p.price - entry) / risk >= minRR);
  if (viable) {
    // Take profit just before the pool — front-run the crowd's exit.
    const buffer = Math.max(atr * 0.15, entry * 0.0003);
    target = isBuy ? viable.price - buffer : viable.price + buffer;
    notes.push(`target set at ${viable.kind.toLowerCase().replace(/_/g, " ")} @ ${viable.price.toFixed(2)}`);
  } else {
    target = isBuy ? entry + risk * minRR : entry - risk * minRR;
    notes.push(`no liquidity pool clears ${minRR}R — using measured ${minRR}R target`);
  }

  const rr = Math.abs(target - entry) / risk;
  if (rr < minRR) return null;

  return { entry, stop, target, rr, note: notes.join("; ") };
}
