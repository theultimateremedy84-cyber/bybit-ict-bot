# Default margin-based TP / SL (7,000 USDT margin @ 50x)

Every new trade now defaults to:

- Take profit = 10% of the committed margin -> 700 USDT on a 7,000 USDT margin
- Stop loss   = 50% of the committed margin -> 3,500 USDT on a 7,000 USDT margin

With 50x leverage the 7,000 USDT margin controls ~350,000 USDT notional, so the
price distances placed on Bybit are:

- TP distance = entry * (10 / 100) / 50 = entry * 0.2%
- SL distance = entry * (50 / 100) / 50 = entry * 1.0%

## What changed

| File | Change |
| --- | --- |
| `lib/db/src/schema/botSettings.ts` | Added `margin_exit_defaults_version` column (default 1) alongside the PERCENT 50 / 10 exit defaults. |
| `artifacts/api-server/src/lib/ensureDb.ts` | Boot migration adds the version column and force-resets existing rows once to `stop_loss_mode=PERCENT / 50` and `take_profit_mode=PERCENT / 10`. |
| `scripts/init-db.mjs` | Same one-time reset for the standalone DB init script. |

The reset is guarded by `margin_exit_defaults_version`, so it runs exactly once
per database. Anything you change afterwards in Settings is preserved.

Open positions are not modified — the defaults apply to newly opened trades.

## Where to place these files in GitHub

```
bybit-ict-bot/                       <- repo root
├── artifacts/api-server/src/lib/ensureDb.ts
├── lib/db/src/schema/botSettings.ts
├── scripts/init-db.mjs
└── TP-SL-MARGIN-DEFAULTS.md
```

Commit, let Railway redeploy, and the migration applies on boot.
