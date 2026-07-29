import { Router, type IRouter } from "express";
import { getBotClient } from "../lib/botRunner";

const router: IRouter = Router();

router.get("/account", async (req, res) => {
  try {
    const client = getBotClient();
    if (!client) {
      res.json({
        accountId: "--",
        accountName: "Bot Offline",
        balance: 0,
        available: 0,
        unrealisedPnl: 0,
        equity: 0,
        currency: "USDT",
        status: "OFFLINE",
        accountType: "UNIFIED",
      });
      return;
    }

    const wallet = await client.getWalletBalance();
    if (!wallet) {
      res.status(404).json({ error: "Could not fetch wallet balance" });
      return;
    }

    res.json({
      accountId: "bybit-unified",
      accountName: "Bybit UNIFIED",
      balance: wallet.totalWalletBalance,
      available: wallet.totalAvailableBalance,
      unrealisedPnl: wallet.totalUnrealisedPnl,
      equity: wallet.totalEquity,
      currency: "USDT",
      status: "ACTIVE",
      accountType: wallet.accountType,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get account");
    res.status(500).json({ error: "Failed to get account info" });
  }
});

export default router;
