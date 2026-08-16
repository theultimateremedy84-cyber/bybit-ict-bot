# Institutional Order Flow + ICT — Upgrade Guide

This package upgrades the bot from a pure ICT/structure bot into a
**structure + institutional order flow** bot suitable for BTC and other liquid
USDT perpetuals.

## Where each file goes (paths are relative to your repo root)

```
bybit-ict-bot/
├── artifacts/api-server/src/lib/
│   ├── orderFlow.ts        ← NEW    institutional order-flow engine
│   ├── instruments.ts      ← NEW    live Bybit contract specs (any symbol)
│   ├── bybitApi.ts         ← REPLACE new market-data + order endpoints
│   ├── ictStrategy.ts      ← REPLACE structure + flow confluence
│   ├── riskManager.ts      ← REPLACE institutional risk + trade management
│   └── botRunner.ts        ← REPLACE main loop wiring
├── artifacts/api-server/src/routes/
│   └── settings.ts         ← REPLACE exposes the new settings
├── lib/db/src/schema/
│   ├── botSettings.ts      ← REPLACE new config columns
│   ├── signals.ts          ← REPLACE order-flow evidence columns
│   └── trades.ts           ← REPLACE order-flow score column
└── scripts/
    └── init-db.mjs         ← REPLACE idempotent ALTER TABLE migrations
```

Nothing else in your repo changes. The dashboard, Dockerfile, and workspace
config are untouched.

## Deploy steps

1. Copy the files above over your repo (same paths).
2. `pnpm install` (no new dependencies were added).
3. Run the migrations: `node scripts/init-db.mjs`
   — every statement is `IF NOT EXISTS`, so it is safe to re-run.
4. `pnpm build` then redeploy.
5. Keep `BYBIT_DEMO=true` for at least 2–4 weeks before considering live.

## What was added

**Order flow engine (`orderFlow.ts`)** — all from Bybit V5 public data:

| Layer | Source | What it answers |
|---|---|---|
| Book imbalance + walls | `/v5/market/orderbook` (200 deep) | Where is resting liquidity actually sitting? |
| Aggressor delta + whale prints | `/v5/market/recent-trade` (1000) | Is real size lifting offers or hitting bids? |
| Volume profile (POC/VAH/VAL/HVN/LVN) | 5m klines | Where is value, where does price travel fast? |
| Session VWAP + 1σ/2σ bands | 5m klines | The institutional execution benchmark |
| Open interest delta | `/v5/market/open-interest` | New positioning vs. covering/liquidation |
| Funding rate | `/v5/market/funding/history` | Is the crowd over-levered on one side? |
| Retail long/short ratio | `/v5/market/account-ratio` | What is the crowd positioned in? |
| Absorption detection | klines | Is passive size soaking up aggression? |
| Liquidity map | equal highs/lows, PDH/PDL, PWH/PWL, session extremes, book walls | Where are the stops institutions target? |

These fold into one signed score (−100..+100) that the strategy uses to
**confirm, boost, penalise or veto** every ICT setup.

**Strategy changes (`ictStrategy.ts`)**
- Order-flow **veto**: structure says buy, but real size is aggressively
  selling into the level → no trade. This is the single biggest change.
- Order-flow **confirmation requirement** (optional, on by default).
- Absorption against the trade is an immediate disqualifier.
- Confidence is now structure (~100) plus ±25 from flow, with extra bonuses for
  aligned absorption, OI confirmation and whale delta.
- **Liquidity-aware stops and targets**: the stop is pushed beyond the nearest
  liquidity pool (plus an ATR buffer) instead of sitting inside the stop-hunt
  zone; the target is the pool the market is actually reaching for, taken just
  in front of the crowd.
- **Crypto mode**: kill zones still add confidence, but 24/7 markets no longer
  require one — outside a kill zone the setup must be flow-led instead.
- **Spread gate**: skips symbols whose book is too thin to fill well.
- **Limit vs market entry**: passive limit at the zone when price hasn't
  arrived yet, market only when it has. No more chasing.

**Risk changes (`riskManager.ts`)**
- Sizing now uses the **live Bybit contract spec** (tick size, qty step,
  min/max qty) instead of a hardcoded table — so any listed USDT perp works.
- **Leverage and notional ceilings** per position and portfolio-wide.
- **Correlation control**: `CORRELATION_GROUPS` stops the bot from opening
  five "different" alt longs that are really one leveraged BTC bet.
- **Confidence-scaled risk**: higher conviction gets more size, capped at your
  configured risk %.
- Sizing **rejects** rather than silently rounding up to the exchange minimum
  (which would have over-risked small accounts).
- **ATR volatility stop floor** replaces the fixed 0.3% floor.
- **In-trade management**: break-even + fees at 1R, then a 1.5 ATR trail from
  1.5R, pushed to Bybit via `/v5/position/trading-stop`.

## New settings (all have safe defaults)

| Setting | Default | Meaning |
|---|---|---|
| `useOrderFlow` | `true` | Master switch for the flow engine |
| `orderFlowVetoThreshold` | `25` | Veto when flow opposes by this much |
| `requireFlowConfirmation` | `true` | Require flow to actively agree |
| `minFlowConfirmation` | `12` | Minimum aligned flow score |
| `cryptoMode` | `true` | Allow flow-led trades outside kill zones |
| `maxRelativeSpread` | `0.0008` | Skip books wider than 8 bps |
| `maxLeverage` | `5` | Per-position notional cap (× equity) |
| `scaleByConfidence` | `true` | Size scales with signal confidence |
| `maxPerCorrelationGroup` | `2` | Max positions in one correlation group |
| `maxDirectionalLeverage` | `3` | Max same-direction exposure (× equity) |
| `maxTotalLeverage` | `5` | Max total exposure (× equity) |
| `breakEvenAtR` / `trailAtR` / `trailAtrMultiple` | `1.0` / `1.5` / `1.5` | Trade management |

## Suggested starting configuration for BTC

```
enabledMarkets:   BTCUSDT,ETHUSDT,SOLUSDT
riskPerTrade:     0.5
minRR:            2.0
minConfidence:    62
maxOpenTrades:    3
maxLeverage:      3
requireFlowConfirmation: true
```

Start with BTCUSDT and ETHUSDT only. They have the deepest books, so the order
flow signal is cleanest — the engine is most reliable exactly where liquidity
is deepest, and noisiest on thin alts.

## Honest caveats

- Bybit REST snapshots are polled, not streamed. Book imbalance and delta are
  point-in-time reads at scan time (every 5 minutes), not a continuous CVD.
  For true tick-by-tick flow you'd need the Bybit WebSocket feed — a sensible
  next step once this is proven on demo.
- The order-flow veto will materially reduce trade frequency. That is the
  intended behaviour: it removes the trades where structure looked right but
  nobody with size was participating.
- Nothing here guarantees profitability. Run it on demo, collect at least
  50–100 signals, and compare win rate and average R against your current
  version before risking real capital.
