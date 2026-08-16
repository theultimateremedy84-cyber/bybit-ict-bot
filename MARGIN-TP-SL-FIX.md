# Margin-based TP/SL and fixed-size leverage fix

Copy the files in this patch into the same paths in the existing bot
repository. This is intentionally a patch archive, not a complete project.

## Settings after deployment

1. Set **Trade Amount / Position Notional (USDT)** to `350000`.
2. Set **Leverage (x)** to `50`.
3. Set **Stop Loss Method** to **Fixed percentage** and **Margin Loss (%)** to
   `50`.
4. Set **Take Profit Method** to **Fixed percentage** and **Margin Profit (%)**
   to `10`.

The trade amount remains the position notional used by the existing bot. At
50x, a 350,000 USDT position uses approximately 7,000 USDT of margin. The
resulting targets are based on that margin:

- 10% margin profit = 700 USDT
- 50% margin loss = 3,500 USDT

The bot now sets the requested leverage before placing a fixed-notional order,
uses the live Bybit instrument leverage ceiling, and reports a clear cap when
the account balance, symbol, or exchange limits prevent the requested size.
The database startup migration changes legacy fixed-size rows that still have
the old 5x default to 50x. Existing positions are not modified.

Always verify the result with Demo Trading or Testnet before enabling live
trading. A 350,000 USDT **margin collateral** request would represent a
17,500,000 USDT position at 50x and requires sufficient available balance and
exchange limits; the dashboard field is the position notional for compatibility
with the existing bot.