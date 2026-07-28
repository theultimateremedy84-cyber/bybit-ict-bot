import { Router, type IRouter } from "express";
import { getBotClient } from "../lib/botRunner";

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

const router: IRouter = Router();

router.get("/positions", async (req, res) => {
  try {
    const client = getBotClient();
    if (!client) {
      res.json([]);
      return;
    }

    const positions = await client.getPositions();

    const result = positions.map((p) => ({
      dealId:      `${p.symbol}-${p.side}`,
      symbol:      p.symbol,
      market:      MARKET_MAP[p.symbol] ?? p.symbol,
      direction:   p.side === "Buy" ? "BUY" : "SELL",
      size:        p.size,
      notionalValue: p.avgPrice * p.size,
      openLevel:   p.avgPrice,
      currentPrice: p.avgPrice + (p.unrealisedPnl / p.size || 0),
      unrealisedPnl: p.unrealisedPnl,
      stopLevel:   p.stopLoss > 0 ? p.stopLoss : null,
      limitLevel:  p.takeProfit > 0 ? p.takeProfit : null,
      leverage:    p.leverage,
      liqPrice:    p.liqPrice > 0 ? p.liqPrice : null,
      currency:    "USDT",
    }));

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to get positions");
    res.status(500).json({ error: "Failed to get positions" });
  }
});

router.delete("/positions/:symbol", async (req, res) => {
  try {
    const symbol = req.params.symbol;
    const client = getBotClient();

    if (!client) {
      res.status(400).json({ error: "Bot not running — start the bot first" });
      return;
    }

    await client.closePosition(symbol);
    res.json({
      success: true,
      symbol,
      message: "Position closed successfully",
    });
  } catch (err) {
    req.log.error({ err }, "Failed to close position");
    const msg = err instanceof Error ? err.message : "Failed to close position";
    if (msg.includes("No open position")) {
      res.status(404).json({ error: "Position not found" });
    } else {
      res.status(500).json({ error: msg });
    }
  }
});

export default router;
