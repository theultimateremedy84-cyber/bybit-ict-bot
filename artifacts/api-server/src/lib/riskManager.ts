/**
 * Risk Management Module — Bybit USDT Perpetuals
 *
 * On Bybit linear perpetuals, position size is denominated in the BASE currency
 * (e.g. BTC qty for BTCUSDT, ETH qty for ETHUSDT).
 * P&L formula: (exitPrice - entryPrice) × qty  (for BUY)
 *
 * Therefore:
 *   size (qty) = riskAmount / stopDistance
 *   where stopDistance = |entryPrice - stopLoss| in USDT per coin
 *
 * No "contract multiplier" is needed — the formula is direct.
 */

export interface RiskParams {
  accountBalance: number;
  riskPerTrade: number;  // percentage, e.g. 1.0 = 1%
  entryPrice: number;
  stopLoss: number;
  symbol: string;
  minSize?: number;
  maxSize?: number;
  decimalPlaces?: number;
}

export interface SizeResult {
  size: number;
  riskAmount: number;
  riskPercent: number;
  stopDistance: number;
}

/**
 * Calculate position size (qty in base currency) based on risk percentage.
 */
export function calculatePositionSize(params: RiskParams): SizeResult {
  const {
    accountBalance,
    riskPerTrade,
    entryPrice,
    stopLoss,
    symbol,
    decimalPlaces,
  } = params;

  const minSize = params.minSize ?? getMinSizeForSymbol(symbol);
  const maxSize = params.maxSize ?? getMaxSizeForSymbol(symbol);
  const dp      = decimalPlaces ?? getDecimalPlacesForSymbol(symbol);

  const riskAmount  = (accountBalance * riskPerTrade) / 100;
  const stopDistance = Math.abs(entryPrice - stopLoss);

  if (stopDistance <= 0) {
    return { size: minSize, riskAmount, riskPercent: riskPerTrade, stopDistance: 0 };
  }

  // size (coins) = riskAmount / stopDistance
  let size = riskAmount / stopDistance;

  // Round down to the correct decimal places
  const factor = Math.pow(10, dp);
  size = Math.floor(size * factor) / factor;

  // Clamp
  size = Math.max(minSize, Math.min(maxSize, size));

  return { size, riskAmount, riskPercent: riskPerTrade, stopDistance };
}

export interface DailyRiskState {
  tradesToday: number;
  pnlToday: number;
  dailyLossLimit: number;
  accountBalance: number;
}

export function isDailyLossLimitBreached(state: DailyRiskState): boolean {
  const limitAmount = (state.accountBalance * state.dailyLossLimit) / 100;
  return state.pnlToday <= -Math.abs(limitAmount);
}

export function canOpenNewTrade(
  openPositionsCount: number,
  maxOpenTrades: number,
  dailyRisk: DailyRiskState
): { allowed: boolean; reason?: string } {
  if (isDailyLossLimitBreached(dailyRisk)) {
    return {
      allowed: false,
      reason: `Daily loss limit of ${dailyRisk.dailyLossLimit}% breached (${dailyRisk.pnlToday.toFixed(2)} USDT)`,
    };
  }

  if (openPositionsCount >= maxOpenTrades) {
    return {
      allowed: false,
      reason: `Max open trades (${maxOpenTrades}) reached`,
    };
  }

  return { allowed: true };
}

/**
 * Format a price to the appropriate decimal places for Bybit order submission.
 *  BTC  → 1 decimal  (e.g. 64000.5)
 *  ETH  → 2 decimals (e.g. 3200.50)
 *  SOL / BNB / others → 3 decimals
 *  Low-price alts (XRP, ADA, DOGE) → 4 decimals
 */
export function formatPrice(price: number, symbol: string): number {
  if (symbol.startsWith("BTC"))  return Math.round(price * 10)    / 10;
  if (symbol.startsWith("ETH"))  return Math.round(price * 100)   / 100;
  if (symbol.startsWith("BNB"))  return Math.round(price * 100)   / 100;
  if (symbol.startsWith("SOL"))  return Math.round(price * 1000)  / 1000;
  if (symbol.startsWith("XRP"))  return Math.round(price * 10000) / 10000;
  if (symbol.startsWith("ADA"))  return Math.round(price * 10000) / 10000;
  if (symbol.startsWith("DOGE")) return Math.round(price * 10000) / 10000;
  if (symbol.startsWith("LTC"))  return Math.round(price * 100)   / 100;
  if (symbol.startsWith("LINK")) return Math.round(price * 1000)  / 1000;
  if (symbol.startsWith("AVAX")) return Math.round(price * 1000)  / 1000;
  if (symbol.startsWith("DOT"))  return Math.round(price * 1000)  / 1000;
  if (symbol.startsWith("MATIC"))return Math.round(price * 10000) / 10000;
  if (symbol.startsWith("HYPE")) return Math.round(price * 1000) / 1000;
  if (symbol.startsWith("SUI"))  return Math.round(price * 10000) / 10000;
  if (symbol.startsWith("XAG"))  return Math.round(price * 1000) / 1000;
  if (symbol.startsWith("XAU"))  return Math.round(price * 100) / 100;
  return Math.round(price * 100) / 100;
}

/**
 * Minimum order qty on Bybit USDT perpetuals.
 * Ref: https://bybit-exchange.github.io/docs/v5/market/instrument
 */
export function getMinSizeForSymbol(symbol: string): number {
  if (symbol.startsWith("BTC"))  return 0.001;
  if (symbol.startsWith("ETH"))  return 0.01;
  if (symbol.startsWith("SOL"))  return 0.1;
  if (symbol.startsWith("BNB"))  return 0.01;
  if (symbol.startsWith("XRP"))  return 1;
  if (symbol.startsWith("ADA"))  return 1;
  if (symbol.startsWith("DOGE")) return 10;
  if (symbol.startsWith("LTC"))  return 0.01;
  if (symbol.startsWith("LINK")) return 0.1;
  if (symbol.startsWith("AVAX")) return 0.1;
  if (symbol.startsWith("DOT"))  return 0.1;
  if (symbol.startsWith("MATIC")) return 1;
  return 0.01;
}

/**
 * Maximum position size per symbol.
 * Conservative caps to avoid overleveraged positions.
 */
export function getMaxSizeForSymbol(symbol: string): number {
  if (symbol.startsWith("BTC"))  return 0.05;   // ~$3 200 notional at $64k
  if (symbol.startsWith("ETH"))  return 1;      // ~$3 800 notional
  if (symbol.startsWith("SOL"))  return 20;     // ~$2 800 notional at $140
  if (symbol.startsWith("BNB"))  return 10;     // ~$5 500 notional at $550
  if (symbol.startsWith("XRP"))  return 5000;
  if (symbol.startsWith("ADA"))  return 10000;
  if (symbol.startsWith("DOGE")) return 50000;
  if (symbol.startsWith("LTC"))  return 10;
  if (symbol.startsWith("LINK")) return 100;
  if (symbol.startsWith("AVAX")) return 50;
  if (symbol.startsWith("DOT"))  return 200;
  if (symbol.startsWith("MATIC")) return 5000;
  return 1;
}

/**
 * Decimal places for qty rounding.
 */
export function getDecimalPlacesForSymbol(symbol: string): number {
  if (symbol.startsWith("BTC"))  return 3;
  if (symbol.startsWith("ETH"))  return 2;
  if (symbol.startsWith("SOL"))  return 1;
  if (symbol.startsWith("BNB"))  return 2;
  if (symbol.startsWith("XRP"))  return 0;
  if (symbol.startsWith("ADA"))  return 0;
  if (symbol.startsWith("DOGE")) return 0;
  if (symbol.startsWith("LTC"))  return 2;
  if (symbol.startsWith("LINK")) return 1;
  if (symbol.startsWith("AVAX")) return 1;
  if (symbol.startsWith("DOT"))  return 1;
  if (symbol.startsWith("MATIC")) return 0;
  if (symbol.startsWith("HYPE")) return 1;
  if (symbol.startsWith("SUI"))  return 0;
  if (symbol.startsWith("XAG"))  return 0;
  if (symbol.startsWith("XAU"))  return 2;
  return 2;
}

/**
 * Minimum stop-loss distance for Bybit symbols (as absolute price).
 * Bybit enforces min stop distance; these are conservative floors.
 *   BTC  0.30% — ~$192 at $64k
 *   ETH  0.30% — ~$11  at $3800
 *   Others 0.50%
 */
export function getMinStopDistance(symbol: string, entryPrice: number): number {
  if (symbol.startsWith("BTC")) return entryPrice * 0.003;
  if (symbol.startsWith("ETH")) return entryPrice * 0.003;
  return entryPrice * 0.005;
}

// ═══════════════════════════════════════════════════════════════════════════
// INSTITUTIONAL RISK LAYER
// ═══════════════════════════════════════════════════════════════════════════
//
// The functions above size a single trade in isolation. Desks don't do that —
// they size against portfolio heat, correlation, notional caps and volatility.
// Everything below implements that layer and supersedes the legacy helpers
// when an instrument spec is available.

import type { InstrumentSpec } from "./instruments";
import { roundToQtyStep, roundToTick } from "./instruments";

export interface InstitutionalSizeParams {
  accountBalance: number;
  /** Risk per trade as a percentage of equity, e.g. 0.75 = 0.75%. */
  riskPerTrade: number;
  entryPrice: number;
  stopLoss: number;
  spec: InstrumentSpec;
  /** Hard cap on position notional as a multiple of equity (leverage cap). */
  maxLeverage: number;
  /** Order-type-specific exchange ceiling (market can be lower than limit). */
  maxOrderQty?: number;
  /**
   * Confidence-based scaling. A 90-confidence setup with aligned flow deserves
   * more size than a 60-confidence one; scaling is linear between the bounds
   * and never exceeds the configured risk per trade.
   */
  confidence?: number;
  scaleByConfidence?: boolean;
}

export interface InstitutionalSizeResult {
  qty: number;
  riskAmount: number;
  effectiveRiskPercent: number;
  stopDistance: number;
  notional: number;
  leverageUsed: number;
  rejected: boolean;
  reason?: string;
}

export interface FixedMarginSizeParams {
  /** Desired isolated/cross margin allocation in USDT for one trade. */
  marginPerTradeUsdt: number;
  accountBalance: number;
  entryPrice: number;
  stopLoss: number;
  spec: InstrumentSpec;
  /** Target leverage; the exchange instrument ceiling is still respected. */
  leverage: number;
  /** Order-type-specific exchange ceiling (market can be lower than limit). */
  maxOrderQty?: number;
}

/**
 * Convert a P&L percentage of leveraged margin into a price distance.
 *
 * For a fixed margin M at leverage L:
 *   notional = M × L
 *   qty = (M × L) / entry
 *   price distance for P&L P% = (margin × P%) / qty
 *                    = entry × P% / L
 *
 * This keeps TP/SL tied to the user's actual margin target rather than
 * incorrectly treating the percentage as a percentage move in the market.
 */
export function getMarginBasedPriceDistance(
  entryPrice: number,
  marginPercent: number,
  leverage: number,
): number {
  if (
    !Number.isFinite(entryPrice) ||
    entryPrice <= 0 ||
    !Number.isFinite(marginPercent) ||
    marginPercent <= 0 ||
    !Number.isFinite(leverage) ||
    leverage <= 0
  ) {
    return 0;
  }
  return entryPrice * (marginPercent / 100) / leverage;
}

/**
 * Exact margin-based exit levels for an OPEN position.
 *
 * Anchored to the REAL fill price (not the signal's projected entry) so the
 * targets describe the margin actually committed:
 *
 *   profit/loss at target = marginPercent% x (notional / leverage)
 *   price distance        = fillPrice x marginPercent% / leverage
 *
 * Both levels are also pushed to the valid side of the live price by a
 * minimum gap. Without that guard Bybit triggers the level the instant the
 * position opens and the trade closes at its own entry price for the cost of
 * two taker fees — the exact symptom of "entry price = exit price".
 */
export function computeMarginExitLevels(input: {
  direction: "BUY" | "SELL";
  fillPrice: number;
  markPrice: number;
  leverage: number;
  tpMarginPercent: number;
  slMarginPercent: number;
  spec: InstrumentSpec;
}): { stopLoss: number; takeProfit: number } {
  const { direction, fillPrice, leverage, spec } = input;
  const markPrice = input.markPrice > 0 ? input.markPrice : fillPrice;
  const isBuy = direction === "BUY";

  const tpDistance = getMarginBasedPriceDistance(fillPrice, input.tpMarginPercent, leverage);
  const slDistance = getMarginBasedPriceDistance(fillPrice, input.slMarginPercent, leverage);

  // Never allow a level to sit on, or through, the live price.
  const minGap = Math.max(spec.tickSize * 2, markPrice * 0.0005);

  let takeProfit = isBuy ? fillPrice + tpDistance : fillPrice - tpDistance;
  let stopLoss   = isBuy ? fillPrice - slDistance : fillPrice + slDistance;

  if (isBuy) {
    takeProfit = Math.max(takeProfit, markPrice + minGap);
    stopLoss   = Math.min(stopLoss, markPrice - minGap);
  } else {
    takeProfit = Math.min(takeProfit, markPrice - minGap);
    stopLoss   = Math.max(stopLoss, markPrice + minGap);
  }

  return {
    takeProfit: roundToTick(takeProfit, spec),
    stopLoss: roundToTick(stopLoss, spec),
  };
}

/**
 * Convert a dashboard-configured USDT margin allocation into a valid Bybit quantity.
 *
 * The exchange accepts quantity in base currency (for example BTC), so a
 * 7,000 USDT margin setting at 50x becomes 350,000 USDT notional, then
 * 350000 / entryPrice is rounded down to the symbol's real quantity step.
 * This intentionally does not depend on stop-loss distance or risk percentage.
 */
export function calculateFixedMarginSize(
  params: FixedMarginSizeParams,
): InstitutionalSizeResult {
  const {
    marginPerTradeUsdt,
    accountBalance,
    entryPrice,
    stopLoss,
    spec,
    leverage,
  } = params;

  const stopDistance = Math.abs(entryPrice - stopLoss);
  if (
    !Number.isFinite(marginPerTradeUsdt) ||
    marginPerTradeUsdt <= 0 ||
    !Number.isFinite(accountBalance) ||
    accountBalance <= 0 ||
    !Number.isFinite(entryPrice) ||
    entryPrice <= 0 ||
    stopDistance <= 0
  ) {
    return {
      qty: 0,
      riskAmount: 0,
      effectiveRiskPercent: 0,
      stopDistance,
      notional: 0,
      leverageUsed: 0,
      rejected: true,
      reason: "Invalid fixed margin, entry, stop, or balance",
    };
  }

  // Respect both the requested leverage and the exchange contract maximum.
  // This only reduces an unsafe request; it never increases it.
  const leverageCap = Math.max(0, Math.min(leverage, spec.maxLeverage));
  const maxAllowedNotional = accountBalance * leverageCap;
  const requestedNotional = Math.min(
    marginPerTradeUsdt * leverageCap,
    maxAllowedNotional,
  );

  let qty = roundToQtyStep(requestedNotional / entryPrice, spec);
  const orderQtyCeiling = Math.min(
    spec.maxOrderQty,
    params.maxOrderQty ?? spec.maxOrderQty,
  );
  if (qty > orderQtyCeiling) {
    qty = roundToQtyStep(orderQtyCeiling, spec);
  }

  if (qty < spec.minOrderQty) {
    return {
      qty: 0,
      riskAmount: 0,
      effectiveRiskPercent: 0,
      stopDistance,
      notional: 0,
      leverageUsed: 0,
      rejected: true,
      reason: `Margin ${marginPerTradeUsdt} USDT at ${leverageCap}x produces qty ${qty}, below exchange minimum ${spec.minOrderQty} for ${spec.symbol}.`,
    };
  }

  const notional = qty * entryPrice;
  const riskAmount = qty * stopDistance;

  return {
    qty,
    riskAmount,
    effectiveRiskPercent: (riskAmount / accountBalance) * 100,
    stopDistance,
    notional,
    leverageUsed: notional / accountBalance,
    rejected: false,
    ...(requestedNotional < marginPerTradeUsdt * leverageCap
      ? {
          reason:
            `Requested ${marginPerTradeUsdt} USDT margin at ${leverageCap}x was capped at ${requestedNotional.toFixed(2)} USDT notional by the account/exchange leverage limit.`,
        }
      : {}),
  };
}

/**
 * Size a position from risk, then clamp it against the instrument's real
 * contract limits and the account's leverage ceiling.
 */
export function calculateInstitutionalSize(
  params: InstitutionalSizeParams,
): InstitutionalSizeResult {
  const { accountBalance, entryPrice, stopLoss, spec, maxLeverage } = params;

  const stopDistance = Math.abs(entryPrice - stopLoss);
  if (stopDistance <= 0 || entryPrice <= 0 || accountBalance <= 0) {
    return {
      qty: 0,
      riskAmount: 0,
      effectiveRiskPercent: 0,
      stopDistance,
      notional: 0,
      leverageUsed: 0,
      rejected: true,
      reason: "Invalid entry/stop/balance",
    };
  }

  // Confidence scaling: 60 conf → 60% of nominal risk, 100 conf → 100%.
  let riskPct = params.riskPerTrade;
  if (params.scaleByConfidence && params.confidence !== undefined) {
    const factor = Math.max(0.5, Math.min(1, params.confidence / 100));
    riskPct = params.riskPerTrade * factor;
  }

  const riskAmount = (accountBalance * riskPct) / 100;

  let qty = riskAmount / stopDistance;

  // ── Leverage / notional ceiling ────────────────────────────────────────────
  const maxNotional = accountBalance * maxLeverage;
  const notionalAtQty = qty * entryPrice;
  if (notionalAtQty > maxNotional) {
    qty = maxNotional / entryPrice;
  }

  // ── Contract limits ────────────────────────────────────────────────────────
  qty = roundToQtyStep(qty, spec);
  const orderQtyCeiling = Math.min(
    spec.maxOrderQty,
    params.maxOrderQty ?? spec.maxOrderQty,
  );
  if (qty > orderQtyCeiling) qty = roundToQtyStep(orderQtyCeiling, spec);

  if (qty < spec.minOrderQty) {
    // Do NOT silently bump up to the exchange minimum — that would risk more
    // than the configured percentage. Reject instead and log why.
    return {
      qty: 0,
      riskAmount,
      effectiveRiskPercent: riskPct,
      stopDistance,
      notional: 0,
      leverageUsed: 0,
      rejected: true,
      reason: `Risk-based qty ${qty} is below exchange minimum ${spec.minOrderQty} for ${spec.symbol}. Increase risk %, or trade a cheaper instrument with this balance.`,
    };
  }

  const notional = qty * entryPrice;

  return {
    qty,
    riskAmount,
    effectiveRiskPercent: riskPct,
    stopDistance,
    notional,
    leverageUsed: notional / accountBalance,
    rejected: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Correlation control
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Crypto is one trade wearing many tickers. Five long alts is not five
 * uncorrelated positions — it is one leveraged beta bet on BTC. These groups
 * cap how much of the book can lean the same way.
 */
export const CORRELATION_GROUPS: Record<string, string[]> = {
  MAJORS: ["BTCUSDT", "ETHUSDT"],
  L1_ALTS: ["SOLUSDT", "AVAXUSDT", "ADAUSDT", "DOTUSDT", "NEARUSDT", "APTUSDT", "SUIUSDT", "SEIUSDT"],
  EXCHANGE: ["BNBUSDT", "OKBUSDT"],
  PAYMENTS: ["XRPUSDT", "LTCUSDT", "BCHUSDT"],
  MEME: ["DOGEUSDT", "SHIB1000USDT", "PEPE1000USDT", "WIFUSDT"],
  DEFI: ["LINKUSDT", "UNIUSDT", "AAVEUSDT", "MKRUSDT"],
};

export function getCorrelationGroup(symbol: string): string {
  for (const [group, members] of Object.entries(CORRELATION_GROUPS)) {
    if (members.includes(symbol)) return group;
  }
  return "OTHER";
}

export interface OpenExposure {
  symbol: string;
  direction: "BUY" | "SELL";
  notional: number;
}

/**
 * Portfolio-level gate applied before every new entry.
 */
export function checkPortfolioRisk(params: {
  symbol: string;
  direction: "BUY" | "SELL";
  newNotional: number;
  accountBalance: number;
  openExposures: OpenExposure[];
  /** Max simultaneous positions in the same correlation group. */
  maxPerCorrelationGroup: number;
  /** Max combined notional in one direction, as a multiple of equity. */
  maxDirectionalLeverage: number;
  /** Max total notional across all positions, as a multiple of equity. */
  maxTotalLeverage: number;
}): { allowed: boolean; reason?: string } {
  const {
    symbol,
    direction,
    newNotional,
    accountBalance,
    openExposures,
    maxPerCorrelationGroup,
    maxDirectionalLeverage,
    maxTotalLeverage,
  } = params;

  if (accountBalance <= 0) return { allowed: false, reason: "No account balance" };

  // Never stack a second position on the same symbol.
  if (openExposures.some((e) => e.symbol === symbol)) {
    return { allowed: false, reason: `Already holding a position in ${symbol}` };
  }

  // Never hold both sides of the same correlation group — that is paying two
  // spreads to be flat.
  const group = getCorrelationGroup(symbol);
  const groupPositions = openExposures.filter((e) => getCorrelationGroup(e.symbol) === group);

  if (groupPositions.some((e) => e.direction !== direction)) {
    return {
      allowed: false,
      reason: `Opposing position already open in correlation group ${group} — would net out`,
    };
  }

  if (groupPositions.length >= maxPerCorrelationGroup) {
    return {
      allowed: false,
      reason: `Correlation limit: already ${groupPositions.length} position(s) in group ${group} (max ${maxPerCorrelationGroup})`,
    };
  }

  const directionalNotional =
    openExposures.filter((e) => e.direction === direction).reduce((s, e) => s + e.notional, 0) +
    newNotional;

  if (directionalNotional / accountBalance > maxDirectionalLeverage) {
    return {
      allowed: false,
      reason: `Directional exposure would reach ${(directionalNotional / accountBalance).toFixed(1)}x equity (max ${maxDirectionalLeverage}x)`,
    };
  }

  const totalNotional = openExposures.reduce((s, e) => s + e.notional, 0) + newNotional;
  if (totalNotional / accountBalance > maxTotalLeverage) {
    return {
      allowed: false,
      reason: `Total exposure would reach ${(totalNotional / accountBalance).toFixed(1)}x equity (max ${maxTotalLeverage}x)`,
    };
  }

  return { allowed: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// In-trade management
// ─────────────────────────────────────────────────────────────────────────────

export interface TradeManagementInput {
  direction: "BUY" | "SELL";
  entryPrice: number;
  currentStop: number;
  currentPrice: number;
  initialRisk: number;
  atr: number;
  spec: InstrumentSpec;
  /** Move to break-even once this many R is banked. */
  breakEvenAtR: number;
  /** Begin ATR trailing once this many R is banked. */
  trailAtR: number;
  /** Trail distance in ATR multiples. */
  trailAtrMultiple: number;
  enableTrailing: boolean;
}

export interface TradeManagementAction {
  /** New stop price, or null when no change is warranted. */
  newStop: number | null;
  reason: string;
  rMultiple: number;
}

/**
 * Decide whether a live position's stop should move.
 *
 * Stops only ever move in the trade's favour. Break-even first (removes the
 * loss), then an ATR trail that gives the position room to breathe through
 * normal crypto volatility rather than being scratched by noise.
 */
export function computeTradeManagement(input: TradeManagementInput): TradeManagementAction {
  const {
    direction,
    entryPrice,
    currentStop,
    currentPrice,
    initialRisk,
    atr,
    spec,
    breakEvenAtR,
    trailAtR,
    trailAtrMultiple,
    enableTrailing,
  } = input;

  if (initialRisk <= 0) {
    return { newStop: null, reason: "No initial risk recorded", rMultiple: 0 };
  }

  const isBuy = direction === "BUY";
  const move = isBuy ? currentPrice - entryPrice : entryPrice - currentPrice;
  const rMultiple = move / initialRisk;

  const better = (candidate: number) => (isBuy ? candidate > currentStop : candidate < currentStop);

  // ── ATR trailing (takes priority once far enough in profit) ────────────────
  if (enableTrailing && atr > 0 && rMultiple >= trailAtR) {
    const trailed = isBuy
      ? currentPrice - atr * trailAtrMultiple
      : currentPrice + atr * trailAtrMultiple;
    const rounded = roundToTick(trailed, spec);
    if (better(rounded)) {
      return {
        newStop: rounded,
        reason: `Trailing stop at ${trailAtrMultiple} ATR (${rMultiple.toFixed(2)}R in profit)`,
        rMultiple,
      };
    }
  }

  // ── Break-even ─────────────────────────────────────────────────────────────
  if (rMultiple >= breakEvenAtR) {
    // A tick past entry so fees don't turn a scratch into a small loss.
    const beBuffer = Math.max(spec.tickSize * 2, entryPrice * 0.0004);
    const be = roundToTick(isBuy ? entryPrice + beBuffer : entryPrice - beBuffer, spec);
    if (better(be)) {
      return {
        newStop: be,
        reason: `Moved to break-even + fees (${rMultiple.toFixed(2)}R in profit)`,
        rMultiple,
      };
    }
  }

  return { newStop: null, reason: "No adjustment", rMultiple };
}

/**
 * Volatility-aware minimum stop distance.
 *
 * The old fixed 0.3% floor is far too tight for BTC during an expansion phase
 * and far too wide during a dead Asian session. ATR adapts to both.
 */
export function getVolatilityStopFloor(entryPrice: number, atr: number): number {
  const atrFloor = atr * 0.75;
  const percentFloor = entryPrice * 0.0025; // absolute safety net
  return Math.max(atrFloor, percentFloor);
}
