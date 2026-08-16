# How to merge this update into your GitHub repo

Your existing repo already has `artifacts/api-server/` and `lib/db/`.
This zip adds the missing React frontend and updates 4 existing files.

---

## What's in this zip

```
bybit-ict-bot-UPDATE/
│
│  ── REPLACE these 4 files (copy over your existing ones) ──
├── Dockerfile                          ← now builds the React frontend too
├── pnpm-workspace.yaml                 ← adds dashboard + catalog entries
├── docker-setup.js                     ← adds React/Vite catalog versions
│
├── artifacts/
│   └── api-server/
│       └── src/
│           └── app.ts                  ← now serves the React build statically
│
│  ── ADD these 2 folders (they don't exist in your repo yet) ──
│
├── artifacts/
│   └── dashboard/                      ← the entire React frontend
│       ├── src/
│       │   ├── pages/   (Dashboard, Trades, Signals, Performance, Markets, Settings)
│       │   ├── components/
│       │   └── hooks/
│       ├── package.json
│       ├── vite.config.ts
│       └── ...
│
└── lib/
    └── api-client-react/               ← fetch + TanStack Query client used by the dashboard
        └── src/
```

---

## Step-by-step

### 1. Clone your GitHub repo (if you haven't already)
```bash
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git
cd YOUR_REPO
```

### 2. Copy the 4 replacement files
```bash
# From inside the unzipped bybit-ict-bot-UPDATE/ folder:
cp Dockerfile            /path/to/your/repo/
cp pnpm-workspace.yaml   /path/to/your/repo/
cp docker-setup.js       /path/to/your/repo/

cp artifacts/api-server/src/app.ts  /path/to/your/repo/artifacts/api-server/src/app.ts
```

### 3. Add the 2 new folders
```bash
cp -r artifacts/dashboard     /path/to/your/repo/artifacts/
cp -r lib/api-client-react    /path/to/your/repo/lib/
```

### 4. Commit and push
```bash
cd /path/to/your/repo
git add .
git commit -m "Add React dashboard frontend"
git push
```

### 5. Railway redeploys automatically
Railway picks up the push, runs `docker build`, and your site goes live.
The URL that was showing nothing will now load the full trading dashboard.

---

## Environment variables (Railway → Variables tab)

Make sure these are set in Railway. DATABASE_URL is auto-injected by the
PostgreSQL plugin, so you only need to add the Bybit ones:

| Variable          | Value                          |
|-------------------|-------------------------------|
| BYBIT_API_KEY     | your Bybit API key            |
| BYBIT_API_SECRET  | your Bybit API secret         |
| BYBIT_TESTNET     | true (false for live trading) |
| AUTO_START_BOT    | false (or true to auto-start) |
| NODE_ENV          | production                    |

---

## After deploy

- Visit your Railway URL → the ICT_TERMINAL dashboard loads
- Click **START BOT** to begin trading (or set AUTO_START_BOT=true)
- Go to **Settings** to enter your Bybit API credentials via the UI
