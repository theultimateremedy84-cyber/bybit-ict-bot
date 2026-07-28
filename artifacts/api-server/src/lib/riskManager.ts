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
