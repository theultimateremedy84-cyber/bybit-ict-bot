/**
 * Instrument Registry
 * ===================
 *
 * The original bot hardcoded tick size, qty step, min qty and max size per
 * symbol.  That works for five majors and silently breaks the moment you add a
 * sixth coin — orders get rejected for invalid precision, or sizing clamps to a
 * wrong cap.
 *
 * This module pulls the real contract specification from Bybit
 * (/v5/market/instruments-info) and caches it, so ANY USDT perpetual can be
 * traded correctly with no code change.  Hardcoded values remain only as an
 * offline fallback.
 */

import type { BybitApiClient } from "./bybitApi";
import { logger } from "./logger";

export interface InstrumentSpec {
  symbol: string;
  /** Price increment — every price sent to Bybit must be a multiple of this. */
  tickSize: number;
  /** Quantity increment. */
  qtyStep: number;
  minOrderQty: number;
  maxOrderQty: number;
  maxLeverage: number;
  priceDecimals: number;
  qtyDecimals: number;
}

const cache = new Map<string, { spec: InstrumentSpec; fetchedAt: number }>();
const TTL_MS = 6 * 60 * 60 * 1000; // contract specs change rarely

function decimalsFromStep(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 2;
  const s = step.toString();
  if (s.includes("e-")) return parseInt(s.split("e-")[1], 10);
  const dot = s.indexOf(".");
  return dot === -1 ? 0 : s.length - dot - 1;
}

/** Conservative fallback used only when the instruments endpoint is unreachable. */
function fallbackSpec(symbol: string): InstrumentSpec {
  const table: Record<string, [number, number, number]> = {
    // symbol prefix → [tickSize, qtyStep, minOrderQty]
    BTC: [0.1, 0.001, 0.001],
    ETH: [0.01, 0.01, 0.01],
    SOL: [0.01, 0.1, 0.1],
    BNB: [0.01, 0.01, 0.01],
    XRP: [0.0001, 1, 1],
  };
  const key = Object.keys(table).find((k) => symbol.startsWith(k));
  const [tickSize, qtyStep, minOrderQty] = key ? table[key] : [0.001, 0.1, 0.1];

  return {
    symbol,
    tickSize,
    qtyStep,
    minOrderQty,
    maxOrderQty: 1_000_000,
    maxLeverage: 25,
    priceDecimals: decimalsFromStep(tickSize),
    qtyDecimals: decimalsFromStep(qtyStep),
  };
}

/** Fetch (and cache) the live contract spec for a symbol. */
export async function getInstrumentSpec(
  client: BybitApiClient,
  symbol: string,
): Promise<InstrumentSpec> {
  const hit = cache.get(symbol);
  if (hit && Date.now() - hit.fetchedAt < TTL_MS) return hit.spec;

  try {
    const info = await client.getInstrumentInfo(symbol);
    if (!info) throw new Error("instrument not listed");

    const spec: InstrumentSpec = {
      symbol,
      tickSize: info.tickSize,
      qtyStep: info.qtyStep,
      minOrderQty: info.minOrderQty,
      maxOrderQty: info.maxOrderQty,
      maxLeverage: info.maxLeverage,
      priceDecimals: decimalsFromStep(info.tickSize),
      qtyDecimals: decimalsFromStep(info.qtyStep),
    };

    cache.set(symbol, { spec, fetchedAt: Date.now() });
    logger.info({ symbol, spec }, "Instrument spec loaded from Bybit");
    return spec;
  } catch (err) {
    logger.warn({ symbol, err }, "Falling back to built-in instrument spec");
    const spec = fallbackSpec(symbol);
    cache.set(symbol, { spec, fetchedAt: Date.now() });
    return spec;
  }
}

/** Round a price down/up onto the instrument's tick grid. */
export function roundToTick(price: number, spec: InstrumentSpec): number {
  if (spec.tickSize <= 0) return price;
  const ticks = Math.round(price / spec.tickSize);
  return parseFloat((ticks * spec.tickSize).toFixed(spec.priceDecimals));
}

/** Round a quantity down onto the instrument's qty grid (never round up). */
export function roundToQtyStep(qty: number, spec: InstrumentSpec): number {
  if (spec.qtyStep <= 0) return qty;
  const steps = Math.floor(qty / spec.qtyStep);
  return parseFloat((steps * spec.qtyStep).toFixed(spec.qtyDecimals));
}

export function clearInstrumentCache(): void {
  cache.clear();
}
