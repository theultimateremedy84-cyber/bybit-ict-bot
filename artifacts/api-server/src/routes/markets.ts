import { Router, type IRouter } from "express";
import { getBotClient } from "../lib/botRunner";
import { db } from "@workspace/db";
import { botSettingsTable } from "@workspace/db";

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
  HYPEUSDT: "Hyperliquid",
  SUIUSDT:  "Sui",
  XAGUSDT:  "Silver",
  XAUUSDT:  "Gold",
};

const DEFAULT_MARKETS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"];

function determineTrend(change: number): "BULLISH" | "BEARISH" | "SIDEWAYS" {
  if (change > 0.001) return "BULLISH";
  if (change < -0.001) return "BEARISH";
  return "SIDEWAYS";
}

const router: IRouter = Router();

router.get("/markets", async (req, res) => {
  try {
    const settings = await db.select().from(botSettingsTable).limit(1);
    const enabledMarkets: string[] = settings[0]
      ? settings[0].enabledMarkets.split(",").map((m: string) => m.trim()).filter(Boolean)
      : DEFAULT_MARKETS;

    const client = getBotClient();

    if (!client) {
      const result = enabledMarkets.map((symbol: string) => ({
        symbol,
        name: MARKET_MAP[symbol] ?? symbol,
        lastPrice: 0,
        bid: 0,
        ask: 0,
        change: 0,
        changePercent: 0,
        high24h: 0,
        low24h: 0,
        volume24h: 0,
        spread: 0,
        lastUpdated: new Date().toISOString(),
        trend: "SIDEWAYS" as const,
        activeSignal: null,
      }));
      res.json(result);
      return;
    }

    const tickerMap = await client.getTickers(enabledMarkets);

    const result = enabledMarkets.map((symbol: string) => {
      const t = tickerMap.get(symbol);
      const changePercent = t ? t.price24hPcnt : 0;
      return {
        symbol,
        name: MARKET_MAP[symbol] ?? symbol,
        lastPrice: t?.lastPrice ?? 0,
        bid: t?.bid1Price ?? 0,
        ask: t?.ask1Price ?? 0,
        change: t ? t.lastPrice - (t.lastPrice / (1 + t.price24hPcnt)) : 0,
        changePercent: changePercent * 100,
        high24h: t?.highPrice24h ?? 0,
        low24h: t?.lowPrice24h ?? 0,
        volume24h: t?.volume24h ?? 0,
        spread: t ? Math.abs(t.ask1Price - t.bid1Price) : 0,
        lastUpdated: new Date().toISOString(),
        trend: determineTrend(changePercent),
        activeSignal: null,
      };
    });

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to get markets");
    res.status(500).json({ error: "Failed to get markets" });
  }
});

export default router;
