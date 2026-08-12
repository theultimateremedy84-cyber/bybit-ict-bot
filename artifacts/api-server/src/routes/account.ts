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

    const [wallet, positions] = await Promise.all([
      client.getWalletBalance(),
      client.getPositions().catch(() => []),
    ]);
    if (!wallet) {
      res.status(404).json({ error: "Could not fetch wallet balance" });
      return;
    }

    // Floating PnL from live positions is the most reliable source; the wallet
    // aggregate can lag or be absent depending on account type.
    const positionsUpl = positions.reduce((sum, p) => sum + (p.unrealisedPnl || 0), 0);
    const unrealisedPnl =
      positions.length > 0 ? positionsUpl : wallet.totalUnrealisedPnl;
    const equity = wallet.totalEquity || wallet.totalWalletBalance + unrealisedPnl;

    res.setHeader("Cache-Control", "no-store");
    res.json({
      accountId: "bybit-unified",
      accountName: "Bybit UNIFIED",
      balance: wallet.totalWalletBalance,
      available: wallet.totalAvailableBalance,
      unrealisedPnl,
      equity,
      updatedAt: new Date().toISOString(),
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
