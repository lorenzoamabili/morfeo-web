// ═══════════════════════════════════════════════════════════════
// MORFEO — server.js
// Yahoo Finance proxy + static file serving
// Auth is handled client-side by Firebase.
// ═══════════════════════════════════════════════════════════════

'use strict';

const express = require('express');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 4000;

// ── Middleware ────────────────────────────────────────────────────
app.use(express.json());

// Block access to the server directory
app.use('/server', (_req, res) => res.status(403).end());

// ── Rate limiter (sliding window, per IP) ─────────────────────────
// Protects the Yahoo Finance proxy from being hammered.
const _rlWindows = new Map(); // ip → timestamp[]
function rateLimit(windowMs, maxRequests) {
  return (req, res, next) => {
    const ip  = req.ip;
    const now = Date.now();
    const hits = (_rlWindows.get(ip) || []).filter(t => now - t < windowMs);
    if (hits.length >= maxRequests) {
      return res.status(429).json({ error: 'Too many requests — slow down.' });
    }
    hits.push(now);
    _rlWindows.set(ip, hits);
    next();
  };
}
// 120 API requests per minute per IP — well above normal interactive use
app.use('/api', rateLimit(60_000, 120));

// Serve static files from morfeo-web root (parent of server/)
app.use(express.static(path.join(__dirname, '..')));

// ── Yahoo Finance shared headers ──────────────────────────────────
const YF_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept':          'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer':         'https://finance.yahoo.com/',
};

// ── GET /api/ohlcv ────────────────────────────────────────────────
// Proxies OHLCV chart data from Yahoo Finance.
// Params: symbol, period1, period2, interval
const VALID_INTERVALS = new Set(['1m','2m','5m','15m','30m','60m','90m','1h','1d','5d','1wk','1mo','3mo']);

app.get('/api/ohlcv', async (req, res) => {
  const { symbol, period1, period2, interval } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol required' });

  const p1 = parseInt(period1, 10);
  const p2 = parseInt(period2, 10);
  const iv = VALID_INTERVALS.has(interval) ? interval : '1d';
  if (!Number.isFinite(p1) || !Number.isFinite(p2) || p1 < 0 || p2 < 0) {
    return res.status(400).json({ error: 'invalid period' });
  }

  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?period1=${p1}&period2=${p2}&interval=${iv}&events=history&includePrePost=false`;
  try {
    const r = await fetch(url, { headers: YF_HEADERS });
    if (!r.ok) return res.status(r.status).json({ error: 'Upstream error' });
    res.json(await r.json());
  } catch (err) {
    console.error('[Morfeo] /api/ohlcv error:', err.message);
    res.status(500).json({ error: 'Failed to fetch data' });
  }
});

// ── GET /api/quote ────────────────────────────────────────────────
// Proxies real-time quote + fundamentals from Yahoo Finance.
// Params: symbol
app.get('/api/quote', async (req, res) => {
  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol required' });

  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbol)}`;
  try {
    const r = await fetch(url, { headers: YF_HEADERS });
    if (!r.ok) return res.status(r.status).json({ error: 'Upstream error' });
    res.json(await r.json());
  } catch (err) {
    console.error('[Morfeo] /api/quote error:', err.message);
    res.status(500).json({ error: 'Failed to fetch data' });
  }
});

// ── Ticker search helpers ─────────────────────────────────────────
const GEMINI_KEY = process.env.GEMINI_API_KEY || null;

async function searchYahoo(query) {
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=8&newsCount=0&enableFuzzyQuery=true&lang=en`;
  const r = await fetch(url, { headers: YF_HEADERS });
  if (!r.ok) return [];
  const data = await r.json();
  return (data.quotes || []).filter(q => q.symbol && q.quoteType);
}

async function searchWithGemini(query) {
  const prompt = `You are a financial assistant. The user is searching for a stock ticker.
Query: "${query}"
Return ONLY a JSON array (no markdown, no extra text) of up to 6 results:
[{"symbol":"MSFT","shortname":"Microsoft Corporation","exchange":"NASDAQ","quoteType":"EQUITY"}]
Valid quoteType values: EQUITY, ETF, CRYPTOCURRENCY, INDEX.
If nothing matches confidently, return [].`;

  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 512 },
      }),
    }
  );
  if (!r.ok) return [];
  const data = await r.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const match = text.match(/\[[\s\S]*?\]/);
  if (!match) return [];
  try { return JSON.parse(match[0]); } catch { return []; }
}

// ── GET /api/search ───────────────────────────────────────────────
app.get('/api/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);

  try {
    if (GEMINI_KEY) {
      const [aiResults, yahooResults] = await Promise.all([
        searchWithGemini(q).catch(() => []),
        searchYahoo(q).catch(() => []),
      ]);
      const seen   = new Set(aiResults.map(r => r.symbol));
      const merged = [...aiResults, ...yahooResults.filter(r => !seen.has(r.symbol))];
      return res.json(merged.slice(0, 8));
    }
    res.json(await searchYahoo(q));
  } catch (err) {
    console.error('Search error:', err.message);
    res.json([]);
  }
});

// ── SPA fallback ──────────────────────────────────────────────────
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, '..', 'index.html'));
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

// ── Start (auto-find free port) ───────────────────────────────────
function startServer(port) {
  const server = app.listen(port, () => {
    console.log(`Morfeo running → http://localhost:${server.address().port}`);
  });
  server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
      console.log(`Port ${port} in use — trying ${port + 1}…`);
      startServer(port + 1);
    } else {
      throw err;
    }
  });
}

startServer(PORT);
