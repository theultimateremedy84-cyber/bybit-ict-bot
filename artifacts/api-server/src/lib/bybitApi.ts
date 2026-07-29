/**
 * Bybit API Client (V5 REST API)
 *
 * Supports:
 *  - USDT Linear Perpetuals (category = "linear")
 *  - HMAC-SHA256 request signing
 *  - Testnet and Mainnet
 *  - Kline (candle) data, tickers, positions, orders, wallet balance
 *
 * The BybitCandle interface is structurally identical to the old CapitalCandle
 * so the ICT strategy engine requires only a single import-line change.
 */

import crypto from "node:crypto";
import { logger } from "./logger";

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
    totalUnrealisedPnl: string;
    totalEquity: string;
  }>;
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

  constructor(apiKey: string, apiSecret: string, testnet = false) {
    this.apiKey    = apiKey;
    this.apiSecret = apiSecret;
    this.baseUrl   = testnet
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

    const resp = await fetch(url, { method: "GET", headers });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Bybit GET ${path} → HTTP ${resp.status}: ${text}`);
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

    const resp = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers,
      body: bodyStr,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Bybit POST ${path} → HTTP ${resp.status}: ${text}`);
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
    if (symbol) params.symbol = symbol;

    const result = await this.get<BybitPositionResult>("/v5/position/list", params, true);
    return (result.list ?? [])
      .filter((p) => p.side !== "" && parseFloat(p.size) > 0)
      .map((p) => ({
        symbol:        p.symbol,
        side:          p.side as "Buy" | "Sell",
        size:          parseFloat(p.size),
        avgPrice:      parseFloat(p.avgPrice),
        unrealisedPnl: parseFloat(p.unrealisedPnl),
        stopLoss:      parseFloat(p.stopLoss),
        takeProfit:    parseFloat(p.takeProfit),
        positionIdx:   p.positionIdx,
        leverage:      parseFloat(p.leverage),
        liqPrice:      parseFloat(p.liqPrice ?? "0"),
      }));
  }

  /**
   * Fetch UNIFIED wallet balance.
   */
  async getWalletBalance(): Promise<BybitWallet | null> {
    try {
      const result = await this.get<BybitWalletResult>(
        "/v5/account/wallet-balance",
        { accountType: "UNIFIED" },
        true,
      );
      const w = result.list?.[0];
      if (!w) return null;
      return {
        accountType:           w.accountType,
        totalWalletBalance:    parseFloat(w.totalWalletBalance),
        totalAvailableBalance: parseFloat(w.totalAvailableBalance),
        totalUnrealisedPnl:    parseFloat(w.totalUnrealisedPnl),
        totalEquity:           parseFloat(w.totalEquity),
      };
    } catch (err) {
      logger.error({ err }, "Failed to fetch Bybit wallet balance");
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
   * Health check — validates API key by fetching wallet balance.
   * Returns true if credentials are valid.
   */
  async isSessionValid(): Promise<boolean> {
    try {
      const wallet = await this.getWalletBalance();
      return wallet !== null;
    } catch {
      return false;
    }
  }

  /** No-op — Bybit uses stateless HMAC signing (no session to destroy). */
  destroy(): void {}
}
