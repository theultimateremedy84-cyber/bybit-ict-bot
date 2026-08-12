# Bybit ICT Trading Bot

An automated crypto trading bot using **ICT (Inner Circle Trader)** Smart Money Concepts, designed exclusively for **Bybit USDT Perpetual** futures.

## Strategy

Multi-timeframe order-flow analysis with ICT entry concepts:

| Layer | Timeframes | Purpose |
|-------|-----------|---------|
| HTF Gate | Monthly / Weekly / Daily | Mandatory bias agreement (≥2/3) |
| Entry TFs | H4 / H1 / M15 | Structure + confluence detection |

**Entry signals:**
- Order Blocks (OB)
- Fair Value Gaps (FVG)
- Liquidity Sweeps
- Break of Structure (BOS)
- Change of Character (ChoCH)

**Kill zones (ICT-correct):**
- London: 07:00–10:00 UTC
- New York: 12:00–15:00 UTC
- Asian: 23:00–02:00 UTC

## Default markets

`BTCUSDT`, `ETHUSDT`, `SOLUSDT`, `BNBUSDT`, `XRPUSDT`

Configurable via `PUT /api/settings` (`enabledMarkets` field).

---

## Quick Start (Railway)

### 1. Fork / push to GitHub

```bash
git init
git remote add origin https://github.com/your-username/bybit-ict-bot.git
git add .
git commit -m "Initial Bybit ICT bot"
git push -u origin main
```

### 2. Create a Railway project

1. [railway.app](https://railway.app) → **New Project → Deploy from GitHub repo**
2. Select your repo — Railway auto-detects the `railway.toml` (Dockerfile builder).

### 3. Add a PostgreSQL database

Railway dashboard → **New → Database → PostgreSQL**.  
Railway automatically injects `DATABASE_URL` into your service.

### 4. Set environment variables

In the Railway service → **Variables** tab:

| Variable | Value |
|----------|-------|
| `BYBIT_API_KEY` | Your Bybit API key |
| `BYBIT_API_SECRET` | Your Bybit API secret |
| `BYBIT_TESTNET` | `true` (testnet) or `false` (live) |
| `AUTO_START_BOT` | `true` to start on boot (optional) |
| `PORT` | Set by Railway automatically |
| `NODE_ENV` | `production` |

### 5. Deploy

Railway triggers a build automatically. Watch logs under **Deployments**.

---

## API Reference

Base path: `https://your-domain.up.railway.app/api`

### Bot control

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/bot/status` | Bot running state, uptime, open positions |
| `POST` | `/bot/start` | Start the trading bot |
| `POST` | `/bot/stop` | Stop the trading bot |

### Account & positions

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/account` | Unified wallet balance |
| `GET` | `/positions` | Open Bybit positions |
| `DELETE` | `/positions/:symbol` | Close a position (e.g. `BTCUSDT`) |

### Data

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/markets` | Live tickers for enabled symbols |
| `GET` | `/signals?limit=20` | Recent ICT signals |
| `GET` | `/trades?limit=50` | Trade history |
| `GET` | `/performance` | P&L stats, win rate, drawdown |

### Settings

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/settings` | Current bot configuration |
| `PUT` | `/settings` | Update configuration |

**Settings body example:**
```json
{
  "riskPerTrade": 1.0,
  "maxOpenTrades": 3,
  "dailyLossLimit": 3.0,
  "enabledMarkets": ["BTCUSDT", "ETHUSDT", "SOLUSDT"],
  "enabledKillZones": ["LONDON", "NEW_YORK", "ASIAN"],
  "minConfidence": 55,
  "minRR": 2.0,
  "bybitApiKey": "YOUR_KEY",
  "bybitApiSecret": "YOUR_SECRET",
  "bybitTestnet": true
}
```

---

## Local development

```bash
# Prerequisites: Node 22+, pnpm 9

cp .env.example .env
# Fill in .env: DATABASE_URL, BYBIT_API_KEY, BYBIT_API_SECRET, PORT=3000

pnpm install
pnpm --filter @workspace/db run push    # Push schema to local DB
pnpm --filter @workspace/api-server run dev
```

The server starts on `http://localhost:3000`.

---

## Architecture

```
pnpm monorepo
├── artifacts/api-server/   Express 5 API + bot engine
│   └── src/lib/
│       ├── bybitApi.ts      Bybit V5 REST client (HMAC-SHA256)
│       ├── ictStrategy.ts   ICT signal detection engine
│       ├── botRunner.ts     Scan loop + trade execution
│       └── riskManager.ts   Position sizing + risk limits
├── lib/db/                  Drizzle ORM + PostgreSQL schema
├── Dockerfile               Multi-stage build for Railway
└── railway.toml             Railway deployment config
```

---

## Risk disclaimer

This bot trades real money. Always test on **testnet** first (`BYBIT_TESTNET=true`). Past performance does not guarantee future results. Use at your own risk.
