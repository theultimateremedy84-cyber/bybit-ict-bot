# TP/SL and market-selection update

This update adds configurable exits and dashboard market selection to the
existing Bybit ICT bot.

## GitHub placement

Copy the files below into the same paths in the existing repository:

```text
artifacts/api-server/src/lib/botRunner.ts
artifacts/api-server/src/lib/ensureDb.ts
artifacts/api-server/src/lib/instruments.ts
artifacts/api-server/src/lib/riskManager.ts
artifacts/api-server/src/routes/account.ts
artifacts/api-server/src/routes/markets.ts
artifacts/api-server/src/routes/settings.ts
artifacts/api-server/dashboard/src/lib/api/api.schemas.ts
artifacts/api-server/dashboard/src/pages/settings.tsx
lib/db/src/generated/api.schemas.ts
lib/db/src/schema/botSettings.ts
```

Alternatively, copy the complete contents of this project over the existing
repository, excluding `node_modules/`, `dist/`, and `.tsbuildinfo` files.

## Settings behavior

- Stop loss: `Strategy level`, `Fixed percentage`, or `ATR multiple`.
- Take profit: `Strategy level`, `Fixed percentage`, or `Risk multiple (R)`.
- Selected markets control both bot scanning and the Market Data page.
- Supported selections include `HYPEUSDT`, `SUIUSDT`, `XAGUSDT`, and `XAUUSDT`.
- Settings apply to newly executed trades. Existing Bybit positions are not
  rewritten when settings are saved.
- The database startup migration adds the new settings columns automatically.

## Deploy

Commit and push the copied files, then let the existing Railway deployment
build and restart. Confirm the bot is stopped while changing settings, verify
the selected Demo/Testnet environment, and test with demo funds first.