# Morfeo v3 — Full Investment Platform

A browser-based investment platform. Works in two modes:
- **Static / Netlify** — runs entirely client-side; Yahoo Finance is called directly (CORS fallback via allorigins). No backend required, no login required.
- **Self-hosted** — run the included Express server for a reliable Yahoo Finance proxy, optional Gemini AI ticker search, and Firebase-based login.

## Features

### Signal Analysis
- **3 timeframes**: Scalp (intraday, 1h bars), Swing (daily), Long-term (weekly)
- **5 indicator families**: RSI, MACD, Bollinger Bands, EMA (200/100/50/25), Ichimoku Cloud
- **ATR & annualised volatility** charts
- **400-trial genetic optimiser** — finds optimal indicator weights for max backtested return
- **Risk profile slider** (Conservative → Speculative) — adjusts signal threshold and position sizing
- **Suggested stop-loss** based on ATR × risk multiplier
- **Suggested position size** (% of balance) per risk level
- **Fundamental data**: P/E, EPS, market cap, beta, dividend yield, 52-week range
- **MACD + RSI sub-charts**, volatility chart
- **Benchmark comparison** vs buy-and-hold

### Portfolio Tracker
- Add positions (symbol, shares, buy price, date, timeframe, risk level, notes)
- Live P&L per position and portfolio total
- **One-click signal refresh** — re-runs optimised analysis and updates signal status
- **Refresh All** button to batch-update all positions
- **Correlation matrix** heatmap across all held positions
- **Export to CSV**

### Watchlist
- Track symbols without holding them
- Bulk refresh signals for all watchlist items
- One-click "Analyse" jumps to full analysis view

### Dashboard
- Portfolio value, total P&L, active buy/sell alerts
- Recent signal overview

### Settings
- Default risk level, timeframe, data period, backtest balance
- All data stored in `localStorage` (persists across sessions)

---

## File Structure

```
morfeo-v3/
├── index.html          ← App shell + all view HTML
├── netlify.toml        ← Netlify config
├── css/
│   └── style.css       ← Full stylesheet
└── js/
    ├── indicators.js   ← Data fetching + all technical indicators
    ├── optimiser.js    ← Signal builder, backtester, genetic optimiser
    ├── portfolio.js    ← localStorage persistence + analytics
    ├── charts.js       ← All Plotly chart renderers
    └── app.js          ← UI controller, routing, event handling
```

---

## Deploy to Netlify (static mode)

The `server/` directory is excluded from Netlify deployments via `.netlifyignore`. The frontend falls back to direct Yahoo Finance calls (with allorigins as a CORS fallback). Firebase auth is optional — if `firebase-config.js` is not filled in, the app runs without login.

**Option A: Netlify Drop (fastest)**
1. Go to https://app.netlify.com/drop
2. Drag & drop the `morfeo-web/` folder
3. Live instantly

**Option B: Git**
1. Push to GitHub
2. Connect repo in Netlify → deploy

---

## Self-hosted (with Express backend)

The Express server provides a reliable Yahoo Finance proxy and optional Gemini AI search.

```bash
cd server
cp .env.example .env   # fill in GEMINI_API_KEY if desired
npm install
npm start              # runs on PORT (default 4000)
```

Then open `http://localhost:4000`.

For production, run the server behind a reverse proxy (nginx, Caddy) and use a process manager:

```bash
npm install -g pm2
pm2 start server.js --name morfeo
pm2 save
```

---

## Run Locally (no backend)

```bash
# Any static server works:
npx serve .
# or
python3 -m http.server 8080
# then open http://localhost:8080
```

> Opening `index.html` directly as a `file://` URL will cause CORS errors.
> Use a local server instead.

---

## Disclaimer

For educational and informational purposes only. Not financial advice.
Backtested results are in-sample and subject to overfitting.
