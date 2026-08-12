/**
 * Bybit API Client (V5 REST API)
 *
 * Supports:
 *  - USDT Linear Perpetuals (category = "linear")
 *  - HMAC-SHA256 request signing
 *  - Mainnet, Testnet, and Demo Trading
 *  - Kline (candle) data, tickers, positions, orders, wallet balance
 *
 * Bybit has THREE distinct environments — each requires different API keys:
 *   Live trading  → https://api.bybit.com          (real money)
 *   Testnet       → https://api-testnet.bybit.com  (legacy sandbox, keys from testnet.bybit.com)
 *   Demo Trading  → https://api-demo.bybit.com     (virtual money, keys from bybit.com → Demo)
 *
 * Demo Trading keys will return HTTP 403 against the Testnet endpoint and vice-versa.
 * Always match the key type to the correct base URL.
 *
 * The BybitCandle interface is structurally identical to the old CapitalCandle
 * so the ICT strategy engine requires only a single import-line change.
 */

import crypto from "node:crypto";
import { logger } from "./logger";

// ─── Optional outbound proxy ──────────────────────────────────────────────────
// Bybit's CDN blocks requests coming from some hosting regions (notably US
// data centres used by Railway/Render/Fly). Those requests never reach Bybit —
// CloudFront answers with HTTP 403 and a body like
//   {"error":"The Amazon CloudFront distribution is configured to block access
//     from your country."}
// which looks like a credential error but is purely network/geo related.
//
// Set BYBIT_PROXY_URL (e.g. http://user:pass@eu-proxy-host:8080) to tunnel all
// Bybit traffic through a proxy located in an allowed region, or redeploy the
// service to a non-US region.
let dispatcherPromise: Promise<unknown | undefined> | null = null;

async function getDispatcher(): Promise<unknown | undefined> {
  const proxyUrl = process.env["BYBIT_PROXY_URL"];
  if (!proxyUrl) return undefined;
  if (!dispatcherPromise) {
    dispatcherPromise = (async () => {
      try {
        const { ProxyAgent } = await import("undici");
        logger.info({ proxy: proxyUrl.replace(/\/\/.*@/, "//***@") }, "Routing Bybit traffic through proxy");
        return new ProxyAgent(proxyUrl);
      } catch (err) {
        logger.error({ err }, "BYBIT_PROXY_URL is set but the proxy agent could not be created");
        return undefined;
      }
    })();
  }
  return dispatcherPromise;
}

/** fetch() wrapper that applies the optional proxy dispatcher. */
async function bybitFetch(url: string, init: RequestInit): Promise<Response> {
  const dispatcher = await getDispatcher();
  return fetch(url, (dispatcher ? { ...init, dispatcher } : init) as RequestInit);
}

/** Turn transport-level failures into an actionable message. */
function describeHttpFailure(method: string, path: string, status: number, body: string): Error {
  if (status === 403) {
    return new Error(
      `Bybit ${method} ${path} → HTTP 403 (blocked before reaching Bybit). ` +
        `This is a region/IP restriction from Bybit's CDN, not an API-key problem. ` +
        `Redeploy this service to an allowed region (e.g. Railway EU/Asia) or set BYBIT_PROXY_URL. ` +
        `Response: ${body.slice(0, 300)}`,
    );
  }
  return new Error(`Bybit ${method} ${path} → HTTP ${status}: ${body}`);
}

// ─── Public types ─────────────────────────────────────────────────────────────

export interface BybitCandle {
  snapshotTime: string;
  openPrice:  { bid: number; ask: number };
  highPrice:  { bid: number; ask: number };
  lowPrice:   { bid: number; ask: number };
  closePrice: { bid: number; ask: number };
  lastTradedVolume: number;
}

export interface BybitPosition {
  symbol: string;
  side: "Buy" | "Sell" | "";
  size: number;
  avgPrice: number;
  unrealisedPnl: number;
  stopLoss: number;
  takeProfit: number;
  positionIdx: number; // 0 = one-way, 1/2 = hedge
  leverage: number;
  liqPrice: number;
  markPrice: number;
}

export interface BybitTicker {
  symbol: string;
  lastPrice: number;
  bid1Price: number;
  ask1Price: number;
  highPrice24h: number;
  lowPrice24h: number;
  price24hPcnt: number;  // e.g. "0.0251" = +2.51%
  volume24h: number;
  turnover24h: number;
}

/** One side of the order book: [price, size] tuples, best price first. */
export type BybitBookLevel = [price: number, size: number];

export interface BybitOrderBook {
  symbol: string;
  bids: BybitBookLevel[];
  asks: BybitBookLevel[];
  timestamp: number;
}

/** A public trade print, including the aggressor (taker) side. */
export interface BybitPublicTrade {
  price: number;
  size: number;
  /** Taker side — "Buy" means the aggressor lifted the offer. */
  side: "Buy" | "Sell";
  time: number;
}

export interface BybitOpenInterestPoint {
  openInterest: number;
  timestamp: number;
}

export interface BybitLongShortRatio {
  /** Fraction of accounts positioned long, 0..1 */
  buyRatio: number;
  /** Fraction of accounts positioned short, 0..1 */
  sellRatio: number;
  timestamp: number;
}

export interface BybitInstrumentInfo {
  symbol: string;
  tickSize: number;
  qtyStep: number;
  minOrderQty: number;
  maxOrderQty: number;
  maxLeverage: number;
}

export interface BybitWallet {
  totalWalletBalance: number;
  totalAvailableBalance: number;
  totalUnrealisedPnl: number;
  totalEquity: number;
  accountType: string;
}

export type BybitInterval = "1" | "3" | "5" | "15" | "30" | "60" | "120" | "240" | "360" | "720" | "D" | "W" | "M";

// ─── Internal types ───────────────────────────────────────────────────────────

interface BybitResponse<T> {
  retCode: number;
  retMsg: string;
  result: T;
}

interface BybitKlineResult {
  symbol: string;
  category: string;
  list: string[][];  // [startTime, open, high, low, close, volume, turnover]
}

interface BybitTickerResult {
  category: string;
  list: Array<{
    symbol: string;
    lastPrice: string;
    bid1Price: string;
    ask1Price: string;
    highPrice24h: string;
    lowPrice24h: string;
    price24hPcnt: string;
    volume24h: string;
    turnover24h: string;
  }>;
}

interface BybitPositionResult {
  category: string;
  list: Array<{
    symbol: string;
    side: "Buy" | "Sell" | "";
    size: string;
    avgPrice: string;
    unrealisedPnl: string;
    markPrice?: string;
    stopLoss: string;
    takeProfit: string;
    positionIdx: number;
    leverage: string;
    liqPrice: string;
    positionValue: string;
  }>;
}

interface BybitWalletResult {
  list: Array<{
    accountType: string;
    totalWalletBalance: string;
    totalAvailableBalance: string;
    // NOTE: Bybit v5 does NOT return `totalUnrealisedPnl`.
    // UNIFIED accounts expose `totalPerpUPL`; CONTRACT/classic accounts only
    // expose per-coin `coin[].unrealisedPnl`. Both are handled below.
    totalUnrealisedPnl?: string;
    totalPerpUPL?: string;
    totalEquity: string;
    coin?: Array<{
      coin: string;
      unrealisedPnl?: string;
      walletBalance?: string;
      availableToWithdraw?: string;
      equity?: string;
    }>;
  }>;
}

interface BybitQueryApiResult {
  id: string;
  note: string;
  apiKey: string;
  readOnly: number;
  permissions: Record<string, string[]>;
}

interface BybitOrderResult {
  orderId: string;
  orderLinkId: string;
}

// ─── Client ───────────────────────────────────────────────────────────────────

export class BybitApiClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly recvWindow = "5000";

  /**
   * @param apiKey     - Bybit API key
   * @param apiSecret  - Bybit API secret
   * @param testnet    - true → Testnet endpoint (api-testnet.bybit.com)
   * @param demo       - true → Demo Trading endpoint (api-demo.bybit.com)
   *                     When both testnet and demo are true, demo takes priority.
   */
  constructor(apiKey: string, apiSecret: string, testnet = false, demo = false) {
    this.apiKey    = apiKey;
    this.apiSecret = apiSecret;
    this.baseUrl   = demo
      ? "https://api-demo.bybit.com"
      : testnet
        ? "https://api-testnet.bybit.com"
        : "https://api.bybit.com";
  }

  // ── Signature ───────────────────────────────────────────────────────────────

  private sign(payload: string): string {
    return crypto.createHmac("sha256", this.apiSecret).update(payload).digest("hex");
  }

  private buildQueryString(params: Record<string, string | number | boolean>): string {
    return Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join("&");
  }

  // ── HTTP helpers ─────────────────────────────────────────────────────────────

  private async get<T>(
    path: string,
    params: Record<string, string | number | boolean> = {},
    auth = false,
  ): Promise<T> {
    const qs = this.buildQueryString(params);
    const url = `${this.baseUrl}${path}${qs ? `?${qs}` : ""}`;

    const headers: Record<string, string> = { "Content-Type": "application/json" };

    if (auth) {
      const ts = Date.now().toString();
      const signPayload = ts + this.apiKey + this.recvWindow + qs;
      headers["X-BAPI-API-KEY"]    = this.apiKey;
      headers["X-BAPI-TIMESTAMP"]  = ts;
      headers["X-BAPI-RECV-WINDOW"] = this.recvWindow;
      headers["X-BAPI-SIGN"]       = this.sign(signPayload);
    }

    const resp = await bybitFetch(url, { method: "GET", headers });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw describeHttpFailure("GET", path, resp.status, text);
    }

    const data = (await resp.json()) as BybitResponse<T>;
    if (data.retCode !== 0) {
      throw new Error(`Bybit API error (retCode=${data.retCode}): ${data.retMsg}`);
    }
    return data.result;
  }

  private async post<T>(
    path: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    const ts = Date.now().toString();
    const bodyStr = JSON.stringify(body);
    const signPayload = ts + this.apiKey + this.recvWindow + bodyStr;

    const headers: Record<string, string> = {
      "Content-Type":        "application/json",
      "X-BAPI-API-KEY":      this.apiKey,
      "X-BAPI-TIMESTAMP":    ts,
      "X-BAPI-RECV-WINDOW":  this.recvWindow,
      "X-BAPI-SIGN":         this.sign(signPayload),
    };

    const resp = await bybitFetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers,
      body: bodyStr,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw describeHttpFailure("POST", path, resp.status, text);
    }

    const data = (await resp.json()) as BybitResponse<T>;
    if (data.retCode !== 0) {
      throw new Error(`Bybit API error (retCode=${data.retCode}): ${data.retMsg}`);
    }
    return data.result;
  }

  // ── Public API (no auth) ─────────────────────────────────────────────────────

  /**
   * Fetch kline (candlestick) data.
   * Bybit returns candles in descending order (newest first) — we reverse them.
   */
  async getCandles(
    symbol: string,
    interval: BybitInterval,
    limit = 200,
  ): Promise<BybitCandle[]> {
    const result = await this.get<BybitKlineResult>(
      "/v5/market/kline",
      { category: "linear", symbol, interval, limit },
    );

    // list: [startTime, open, high, low, close, volume, turnover]
    // Bybit returns newest first → reverse to oldest-first for the strategy engine
    const candles: BybitCandle[] = (result.list ?? [])
      .map(([startTime, open, high, low, close, volume]) => {
        const o = parseFloat(open);
        const h = parseFloat(high);
        const l = parseFloat(low);
        const c = parseFloat(close);
        return {
          snapshotTime: new Date(parseInt(startTime, 10)).toISOString(),
          openPrice:  { bid: o, ask: o },
          highPrice:  { bid: h, ask: h },
          lowPrice:   { bid: l, ask: l },
          closePrice: { bid: c, ask: c },
          lastTradedVolume: parseFloat(volume),
        } satisfies BybitCandle;
      })
      .reverse(); // oldest → newest

    return candles;
  }

  /**
   * Fetch ticker for a single symbol.
   */
  async getTicker(symbol: string): Promise<BybitTicker | null> {
    try {
      const result = await this.get<BybitTickerResult>(
        "/v5/market/tickers",
        { category: "linear", symbol },
      );
      const t = result.list?.[0];
      if (!t) return null;
      return {
        symbol:       t.symbol,
        lastPrice:    parseFloat(t.lastPrice),
        bid1Price:    parseFloat(t.bid1Price),
        ask1Price:    parseFloat(t.ask1Price),
        highPrice24h: parseFloat(t.highPrice24h),
        lowPrice24h:  parseFloat(t.lowPrice24h),
        price24hPcnt: parseFloat(t.price24hPcnt),
        volume24h:    parseFloat(t.volume24h),
        turnover24h:  parseFloat(t.turnover24h),
      };
    } catch {
      return null;
    }
  }

  /**
   * Fetch tickers for multiple symbols in parallel.
   */
  async getTickers(symbols: string[]): Promise<Map<string, BybitTicker>> {
    const results = await Promise.allSettled(
      symbols.map((s) => this.getTicker(s)),
    );
    const map = new Map<string, BybitTicker>();
    for (let i = 0; i < symbols.length; i++) {
      const r = results[i];
      if (r.status === "fulfilled" && r.value) {
        map.set(symbols[i], r.value);
      }
    }
    return map;
  }

  // ── Authenticated API ────────────────────────────────────────────────────────

  /**
   * Fetch all open positions for a symbol (or all symbols if omitted).
   */
  async getPositions(symbol?: string): Promise<BybitPosition[]> {
    const params: Record<string, string | number | boolean> = { category: "linear", limit: 50 };
    // Bybit v5 requires either `symbol` or `settleCoin` for linear positions,
    // otherwise it returns retCode 10001 "Missing some parameters".
    if (symbol) params.symbol = symbol;
    else params.settleCoin = "USDT";

    const result = await this.get<BybitPositionResult>("/v5/position/list", params, true);
    return (result.list ?? [])
      .filter((p) => p.side !== "" && parseFloat(p.size) > 0)
      .map((p) => ({
        symbol:        p.symbol,
        side:          p.side as "Buy" | "Sell",
        size:          parseFloat(p.size),
        avgPrice:      parseFloat(p.avgPrice),
        unrealisedPnl: parseFloat(p.unrealisedPnl),
        markPrice:     parseFloat(p.markPrice ?? p.avgPrice ?? "0"),
        stopLoss:      parseFloat(p.stopLoss),
        takeProfit:    parseFloat(p.takeProfit),
        positionIdx:   p.positionIdx,
        leverage:      parseFloat(p.leverage),
        liqPrice:      parseFloat(p.liqPrice ?? "0"),
      }));
  }

  /**
   * Fetch wallet balance.
   *
   * Tries UNIFIED first (Unified Trading Account / UTA).
   * If the account is Classic (non-UTA), falls back to CONTRACT automatically.
   * Demo accounts often default to Classic mode — the fallback makes this
   * transparent so the bot works on both account types without configuration.
   */
  async getWalletBalance(): Promise<BybitWallet | null> {
    for (const accountType of ["UNIFIED", "CONTRACT"] as const) {
      try {
        const result = await this.get<BybitWalletResult>(
          "/v5/account/wallet-balance",
          { accountType },
          true,
        );
        const w = result.list?.[0];
        if (!w) continue;

        // Unrealised (floating) PnL resolution order:
        //  1) totalPerpUPL   — UNIFIED account aggregate
        //  2) totalUnrealisedPnl — defensive, in case Bybit ever returns it
        //  3) sum of coin[].unrealisedPnl — CONTRACT / classic accounts
        const coinUpl = (w.coin ?? []).reduce(
          (sum, c) => sum + (parseFloat(c.unrealisedPnl || "0") || 0),
          0,
        );
        const upl =
          w.totalPerpUPL !== undefined && w.totalPerpUPL !== ""
            ? parseFloat(w.totalPerpUPL)
            : w.totalUnrealisedPnl !== undefined && w.totalUnrealisedPnl !== ""
              ? parseFloat(w.totalUnrealisedPnl)
              : coinUpl;

        const coinWallet = (w.coin ?? []).reduce(
          (sum, c) => sum + (parseFloat(c.walletBalance || "0") || 0),
          0,
        );
        const coinEquity = (w.coin ?? []).reduce(
          (sum, c) => sum + (parseFloat(c.equity || "0") || 0),
          0,
        );
        const coinAvail = (w.coin ?? []).reduce(
          (sum, c) => sum + (parseFloat(c.availableToWithdraw || "0") || 0),
          0,
        );

        return {
          accountType:           w.accountType || accountType,
          totalWalletBalance:    parseFloat(w.totalWalletBalance    || "0") || coinWallet,
          totalAvailableBalance: parseFloat(w.totalAvailableBalance || "0") || coinAvail,
          totalUnrealisedPnl:    Number.isFinite(upl) ? upl : 0,
          totalEquity:           parseFloat(w.totalEquity           || "0") || coinEquity,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn({ accountType, err: msg }, "getWalletBalance: accountType failed, trying next");
      }
    }
    logger.error("Failed to fetch Bybit wallet balance for both UNIFIED and CONTRACT account types");
    return null;
  }

  /**
   * Query API key metadata — used for credential validation.
   * Only requires basic "Read" permission, works on all account types
   * (UNIFIED, CONTRACT, Classic) and on all environments (Live, Testnet, Demo).
   */
  async queryApiKey(): Promise<BybitQueryApiResult | null> {
    try {
      return await this.get<BybitQueryApiResult>("/v5/user/query-api", {}, true);
    } catch (err) {
      logger.error({ err }, "Failed to query Bybit API key info");
      return null;
    }
  }

  /**
   * Create a market order with stop-loss and take-profit.
   * Returns the Bybit orderId.
   */
  async createOrder(params: {
    symbol: string;
    side: "Buy" | "Sell";
    qty: number;
    stopLoss?: number;
    takeProfit?: number;
  }): Promise<{ orderId: string }> {
    const body: Record<string, unknown> = {
      category:    "linear",
      symbol:      params.symbol,
      side:        params.side,
      orderType:   "Market",
      qty:         params.qty.toString(),
      timeInForce: "IOC",
      reduceOnly:  false,
      closeOnTrigger: false,
    };

    if (params.stopLoss   !== undefined) body.stopLoss   = params.stopLoss.toString();
    if (params.takeProfit !== undefined) body.takeProfit = params.takeProfit.toString();

    const result = await this.post<BybitOrderResult>("/v5/order/create", body);
    return { orderId: result.orderId };
  }

  /**
   * Close an open position by placing a reduce-only market order in the
   * opposite direction.
   */
  async closePosition(symbol: string): Promise<void> {
    // Fetch the open position to get size and side
    const positions = await this.getPositions(symbol);
    const pos = positions[0];
    if (!pos || pos.size <= 0) {
      throw new Error(`No open position found for ${symbol}`);
    }

    const closeSide = pos.side === "Buy" ? "Sell" : "Buy";
    await this.post<BybitOrderResult>("/v5/order/create", {
      category:       "linear",
      symbol,
      side:           closeSide,
      orderType:      "Market",
      qty:            pos.size.toString(),
      timeInForce:    "IOC",
      reduceOnly:     true,
      closeOnTrigger: false,
    });

    logger.info({ symbol, size: pos.size, side: closeSide }, "Position closed via reduce-only order");
  }

  /**
   * Validate API key credentials.
   *
   * Uses /v5/user/query-api which only requires basic "Read" permission and
   * works on all account types (UNIFIED, CONTRACT, Classic) and environments
   * (Live, Testnet, Demo). This avoids the 403 that /v5/account/wallet-balance
   * throws when the account hasn't been upgraded to Unified Trading Account.
   */
  async validateCredentials(): Promise<{ ok: boolean; reason?: string }> {
    const attempts: Array<() => Promise<unknown>> = [
      // Works on Live/Testnet/Demo with plain "Read" permission
      () => this.get<BybitQueryApiResult>("/v5/user/query-api", {}, true),
      // Demo Trading fallbacks — always available once the key is valid
      () => this.get<BybitPositionResult>("/v5/position/list", { category: "linear", settleCoin: "USDT" }, true),
      () => this.get<BybitWalletResult>("/v5/account/wallet-balance", { accountType: "UNIFIED" }, true),
      () => this.get<BybitWalletResult>("/v5/account/wallet-balance", { accountType: "CONTRACT" }, true),
    ];

    let lastError = "unknown error";
    for (const attempt of attempts) {
      try {
        await attempt();
        return { ok: true };
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        // A CDN/region block affects every endpoint — stop immediately.
        if (lastError.includes("HTTP 403")) break;
        logger.warn({ err: lastError }, "Bybit credential check failed, trying next endpoint");
      }
    }
    logger.error({ baseUrl: this.baseUrl, err: lastError }, "Bybit credential validation failed");
    return { ok: false, reason: lastError };
  }

  async isSessionValid(): Promise<boolean> {
    return (await this.validateCredentials()).ok;
  }


  // ── Order flow market data ───────────────────────────────────────────────────

  /**
   * Fetch the L2 order book. Bybit supports depth up to 500 on linear.
   * Used for resting-liquidity imbalance and wall detection.
   */
  async getOrderBook(symbol: string, limit = 200): Promise<BybitOrderBook> {
    const result = await this.get<{
      s: string;
      b: string[][];
      a: string[][];
      ts: number;
    }>("/v5/market/orderbook", { category: "linear", symbol, limit });

    const parse = (rows: string[][] = []): BybitBookLevel[] =>
      rows.map(([price, size]) => [parseFloat(price), parseFloat(size)] as BybitBookLevel);

    return {
      symbol: result.s ?? symbol,
      bids: parse(result.b),
      asks: parse(result.a),
      timestamp: result.ts ?? Date.now(),
    };
  }

  /**
   * Fetch the recent public trade tape with aggressor side.
   * This is the raw material for genuine (not tick-rule-estimated) delta.
   */
  async getRecentTrades(symbol: string, limit = 1000): Promise<BybitPublicTrade[]> {
    const result = await this.get<{
      list: Array<{ price: string; size: string; side: "Buy" | "Sell"; time: string }>;
    }>("/v5/market/recent-trade", { category: "linear", symbol, limit: Math.min(limit, 1000) });

    return (result.list ?? []).map((t) => ({
      price: parseFloat(t.price),
      size: parseFloat(t.size),
      side: t.side,
      time: parseInt(t.time, 10),
    }));
  }

  /**
   * Open interest history, oldest-first.
   * intervalTime: 5min | 15min | 30min | 1h | 4h | 1d
   */
  async getOpenInterestHistory(
    symbol: string,
    intervalTime: "5min" | "15min" | "30min" | "1h" | "4h" | "1d" = "5min",
    limit = 60,
  ): Promise<BybitOpenInterestPoint[]> {
    const result = await this.get<{
      list: Array<{ openInterest: string; timestamp: string }>;
    }>("/v5/market/open-interest", { category: "linear", symbol, intervalTime, limit });

    return (result.list ?? [])
      .map((r) => ({
        openInterest: parseFloat(r.openInterest),
        timestamp: parseInt(r.timestamp, 10),
      }))
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  /** Most recent settled funding rate (as a fraction, e.g. 0.0001 = 0.01%). */
  async getFundingRate(symbol: string): Promise<number | null> {
    const result = await this.get<{
      list: Array<{ fundingRate: string; fundingRateTimestamp: string }>;
    }>("/v5/market/funding/history", { category: "linear", symbol, limit: 1 });

    const row = result.list?.[0];
    return row ? parseFloat(row.fundingRate) : null;
  }

  /**
   * Long/short account ratio — retail positioning gauge.
   * Not available for every symbol; callers should tolerate null.
   */
  async getLongShortRatio(
    symbol: string,
    period: "5min" | "15min" | "30min" | "1h" | "4h" | "1d" = "1h",
    limit = 2,
  ): Promise<BybitLongShortRatio | null> {
    try {
      const result = await this.get<{
        list: Array<{ buyRatio: string; sellRatio: string; timestamp: string }>;
      }>("/v5/market/account-ratio", { category: "linear", symbol, period, limit });

      const row = result.list?.[0];
      if (!row) return null;
      return {
        buyRatio: parseFloat(row.buyRatio),
        sellRatio: parseFloat(row.sellRatio),
        timestamp: parseInt(row.timestamp, 10),
      };
    } catch {
      return null;
    }
  }

  /**
   * Contract specification — tick size, qty step, min/max qty, max leverage.
   * Lets the bot trade any listed USDT perpetual without hardcoded precision.
   */
  async getInstrumentInfo(symbol: string): Promise<BybitInstrumentInfo | null> {
    const result = await this.get<{
      list: Array<{
        symbol: string;
        priceFilter: { tickSize: string };
        lotSizeFilter: { qtyStep: string; minOrderQty: string; maxOrderQty: string };
        leverageFilter: { maxLeverage: string };
      }>;
    }>("/v5/market/instruments-info", { category: "linear", symbol });

    const i = result.list?.[0];
    if (!i) return null;

    return {
      symbol: i.symbol,
      tickSize: parseFloat(i.priceFilter.tickSize),
      qtyStep: parseFloat(i.lotSizeFilter.qtyStep),
      minOrderQty: parseFloat(i.lotSizeFilter.minOrderQty),
      maxOrderQty: parseFloat(i.lotSizeFilter.maxOrderQty),
      maxLeverage: parseFloat(i.leverageFilter.maxLeverage),
    };
  }

  /**
   * Amend the stop-loss / take-profit of an OPEN position.
   * Used by the trade manager for break-even moves and ATR trailing stops.
   */
  async setTradingStop(params: {
    symbol: string;
    stopLoss?: number;
    takeProfit?: number;
    positionIdx?: number;
  }): Promise<void> {
    const body: Record<string, unknown> = {
      category: "linear",
      symbol: params.symbol,
      positionIdx: params.positionIdx ?? 0,
      tpslMode: "Full",
    };
    if (params.stopLoss !== undefined) body.stopLoss = params.stopLoss.toString();
    if (params.takeProfit !== undefined) body.takeProfit = params.takeProfit.toString();

    await this.post<Record<string, unknown>>("/v5/position/trading-stop", body);
  }

  /**
   * Place a LIMIT order — used for passive entries at an order block / FVG so
   * the bot joins the resting bid/offer instead of paying the spread and
   * signalling itself to the tape.
   */
  async createLimitOrder(params: {
    symbol: string;
    side: "Buy" | "Sell";
    qty: number;
    price: number;
    stopLoss?: number;
    takeProfit?: number;
    postOnly?: boolean;
  }): Promise<{ orderId: string }> {
    const body: Record<string, unknown> = {
      category: "linear",
      symbol: params.symbol,
      side: params.side,
      orderType: "Limit",
      qty: params.qty.toString(),
      price: params.price.toString(),
      timeInForce: params.postOnly ? "PostOnly" : "GTC",
      reduceOnly: false,
      closeOnTrigger: false,
    };
    if (params.stopLoss !== undefined) body.stopLoss = params.stopLoss.toString();
    if (params.takeProfit !== undefined) body.takeProfit = params.takeProfit.toString();

    const result = await this.post<BybitOrderResult>("/v5/order/create", body);
    return { orderId: result.orderId };
  }

  /** Cancel a resting order (used to expire unfilled limit entries). */
  async cancelOrder(symbol: string, orderId: string): Promise<void> {
    await this.post<BybitOrderResult>("/v5/order/cancel", {
      category: "linear",
      symbol,
      orderId,
    });
  }

  /** List open (unfilled) orders for a symbol. */
  async getOpenOrders(symbol?: string): Promise<Array<{ orderId: string; symbol: string; createdTime: number }>> {
    const params: Record<string, string | number | boolean> = { category: "linear", limit: 50 };
    if (symbol) params.symbol = symbol;
    else params.settleCoin = "USDT";

    const result = await this.get<{
      list: Array<{ orderId: string; symbol: string; createdTime: string }>;
    }>("/v5/order/realtime", params, true);

    return (result.list ?? []).map((o) => ({
      orderId: o.orderId,
      symbol: o.symbol,
      createdTime: parseInt(o.createdTime, 10),
    }));
  }

  /** No-op — Bybit uses stateless HMAC signing (no session to destroy). */
  destroy(): void {}
}
