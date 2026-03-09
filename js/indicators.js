// ═══════════════════════════════════════════════════════════════
// MORFEO v3 — indicators.js
// Data fetching + all technical indicators
// ═══════════════════════════════════════════════════════════════

const ALLORIGINS = 'https://api.allorigins.win/get?url=';
const YF_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const YF_QUOTE = 'https://query1.finance.yahoo.com/v7/finance/quote?symbols=';
const YF_SEARCH = 'https://query1.finance.yahoo.com/v1/finance/search';

// ── Search tickers by company name or symbol ─────────────────────

async function searchYahooTickers(query) {
  // Primary: backend proxy (avoids CORS, enables AI if GEMINI_API_KEY is set)
  try {
    const r = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    if (r.ok) {
      const results = await r.json();
      if (results.length > 0) return results;
    }
  } catch (e) { }

  // Fallback: direct Yahoo Finance + allorigins (for offline / no-backend use)
  const url = `${YF_SEARCH}?q=${encodeURIComponent(query)}&quotesCount=8&newsCount=0&enableFuzzyQuery=true`;
  let json;
  try {
    const r = await fetch(url, { mode: 'cors' });
    if (r.ok) json = await r.json();
  } catch (e) { }
  if (!json) {
    try {
      const r = await fetch(ALLORIGINS + encodeURIComponent(url));
      if (r.ok) { const w = await r.json(); json = JSON.parse(w.contents); }
    } catch (e) { }
  }
  return (json?.quotes || []).filter(q => q.symbol && q.quoteType);
}

// ── Fetch OHLCV from Yahoo Finance ──────────────────────────────

async function fetchYahooOHLCV(symbol, period1, period2, interval = '1d') {
  // Primary: backend proxy (avoids CORS blocks on hosted environments)
  try {
    const r = await fetch(
      `/api/ohlcv?symbol=${encodeURIComponent(symbol)}&period1=${period1}&period2=${period2}&interval=${interval}`
    );
    if (r.ok) {
      const json = await r.json();
      if (json?.chart?.result) return parseOHLCV(json, symbol);
    }
  } catch (e) { }

  // Fallback: direct Yahoo Finance (works locally, may be CORS-blocked when hosted)
  const url = `${YF_BASE}${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=${interval}&events=history`;
  let json;
  try {
    const r = await fetch(url, { mode: 'cors' });
    if (r.ok) json = await r.json();
  } catch (e) { }

  if (!json) {
    const r = await fetch(ALLORIGINS + encodeURIComponent(url));
    if (!r.ok) throw new Error(`Network error fetching ${symbol}`);
    const w = await r.json();
    json = JSON.parse(w.contents);
  }

  return parseOHLCV(json, symbol);
}

function parseOHLCV(json, symbol) {
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(`No data for ${symbol}. Check the ticker symbol.`);

  const ts = result.timestamps || result.timestamp;
  const q = result.indicators.quote[0];
  const meta = result.meta || {};

  if (!ts || !q?.close) throw new Error(`Incomplete data for ${symbol}`);

  const rows = ts.map((t, i) => ({
    date: new Date(t * 1000).toISOString().split('T')[0],
    close: q.close[i],
    high: q.high[i],
    low: q.low[i],
    open: q.open[i],
    volume: q.volume[i]
  })).filter(r => r.close != null && r.high != null && r.low != null);

  if (rows.length < 20) throw new Error(`Insufficient data for ${symbol} (${rows.length} bars). Try a longer period.`);

  return {
    dates: rows.map(r => r.date),
    close: rows.map(r => r.close),
    high: rows.map(r => r.high),
    low: rows.map(r => r.low),
    open: rows.map(r => r.open),
    volume: rows.map(r => r.volume),
    symbol: meta.symbol || symbol,
    name: meta.longName || meta.shortName || symbol,
    currency: meta.currency || 'USD',
    exchange: meta.exchangeName || '',
    lastPrice: meta.regularMarketPrice || rows[rows.length - 1].close
  };
}

// ── Fetch fundamental data from Yahoo quote ──────────────────────

async function fetchFundamentals(symbol) {
  try {
    let json;

    // Primary: backend proxy
    try {
      const r = await fetch(`/api/quote?symbol=${encodeURIComponent(symbol)}`);
      if (r.ok) json = await r.json();
    } catch (e) { }

    // Fallback: direct + allorigins
    if (!json) {
      const url = `${YF_QUOTE}${encodeURIComponent(symbol)}`;
      try {
        const r = await fetch(url, { mode: 'cors' });
        if (r.ok) json = await r.json();
      } catch (e) { }
      if (!json) {
        const r = await fetch(ALLORIGINS + encodeURIComponent(url));
        const w = await r.json();
        json = JSON.parse(w.contents);
      }
    }

    const q = json?.quoteResponse?.result?.[0];
    if (!q) return null;
    return {
      pe: q.trailingPE ? q.trailingPE.toFixed(1) : 'N/A',
      forwardPE: q.forwardPE ? q.forwardPE.toFixed(1) : 'N/A',
      eps: q.epsTrailingTwelveMonths ? q.epsTrailingTwelveMonths.toFixed(2) : 'N/A',
      marketCap: q.marketCap ? fmtMarketCap(q.marketCap) : 'N/A',
      beta: q.beta ? q.beta.toFixed(2) : 'N/A',
      dividendYield: q.dividendYield ? (q.dividendYield * 100).toFixed(2) + '%' : 'N/A',
      dividendYieldRaw: q.dividendYield ? q.dividendYield * 100 : 0,
      fiftyTwoHigh: q.fiftyTwoWeekHigh ? q.fiftyTwoWeekHigh.toFixed(2) : 'N/A',
      fiftyTwoLow: q.fiftyTwoWeekLow ? q.fiftyTwoWeekLow.toFixed(2) : 'N/A',
      avgVolume: q.averageDailyVolume10Day ? fmtVol(q.averageDailyVolume10Day) : 'N/A',
      sector: q.sector || null,
    };
  } catch (e) { return null; }
}

function fmtMarketCap(v) {
  if (v >= 1e12) return (v / 1e12).toFixed(2) + 'T';
  if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  return v.toString();
}
function fmtVol(v) {
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(0) + 'K';
  return v.toString();
}

// ═══════════════════════════════════════════════════════════════
// INDICATOR ENGINE
// ═══════════════════════════════════════════════════════════════

function calcEMA(arr, span) {
  const k = 2 / (span + 1);
  const out = new Array(arr.length).fill(null);
  let prev = null;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] == null) continue;
    if (prev === null) { out[i] = arr[i]; prev = arr[i]; }
    else { out[i] = arr[i] * k + prev * (1 - k); prev = out[i]; }
  }
  return out;
}

function calcSMA(arr, w) {
  return arr.map((_, i) => {
    if (i < w - 1) return null;
    const sl = arr.slice(i - w + 1, i + 1);
    if (sl.some(v => v == null)) return null;
    return sl.reduce((a, b) => a + b, 0) / w;
  });
}

function calcSTD(arr, w) {
  return arr.map((_, i) => {
    if (i < w - 1) return null;
    const sl = arr.slice(i - w + 1, i + 1).filter(v => v != null);
    if (sl.length < 2) return null;
    const m = sl.reduce((a, b) => a + b, 0) / sl.length;
    return Math.sqrt(sl.reduce((a, b) => a + (b - m) ** 2, 0) / sl.length);
  });
}

function calcRSI(close, period = 14) {
  const rsi = new Array(close.length).fill(null);
  if (close.length <= period) return rsi;
  const deltas = close.map((v, i) => i === 0 ? 0 : v - close[i - 1]);
  for (let i = period; i < close.length; i++) {
    const sl = deltas.slice(i - period + 1, i + 1);
    const avgG = sl.filter(d => d > 0).reduce((a, b) => a + b, 0) / period;
    const avgL = sl.filter(d => d < 0).reduce((a, b) => a - b, 0) / period;
    rsi[i] = avgL === 0 ? 100 : 100 - (100 / (1 + avgG / avgL));
  }
  return rsi;
}

function calcMACD(close) {
  const ema12 = calcEMA(close, 12);
  const ema26 = calcEMA(close, 26);
  const macd = ema12.map((v, i) => v != null && ema26[i] != null ? v - ema26[i] : null);
  const filled = macd.map(v => v ?? 0);
  const signal = calcEMA(filled, 9);
  const hist = macd.map((v, i) => v != null && signal[i] != null ? v - signal[i] : null);
  return { macd, signal, hist };
}

function calcBollinger(close, w = 20, mult = 2) {
  const sma = calcSMA(close, w);
  const std = calcSTD(close, w);
  const upper = sma.map((v, i) => v != null && std[i] != null ? v + mult * std[i] : null);
  const lower = sma.map((v, i) => v != null && std[i] != null ? v - mult * std[i] : null);
  return { sma, upper, lower };
}

function calcIchimoku(high, low, close) {
  const n = close.length;

  const rollingHL = (arr, win, fn) => arr.map((_, i) => {
    if (i < win - 1) return null;
    return fn(...arr.slice(i - win + 1, i + 1));
  });

  const tenkan = high.map((_, i) => {
    if (i < 8) return null;
    return (Math.max(...high.slice(i - 8, i + 1)) + Math.min(...low.slice(i - 8, i + 1))) / 2;
  });
  const kijun = high.map((_, i) => {
    if (i < 25) return null;
    return (Math.max(...high.slice(i - 25, i + 1)) + Math.min(...low.slice(i - 25, i + 1))) / 2;
  });
  const spanA = tenkan.map((t, i) => {
    const k = kijun[i];
    return t != null && k != null ? (t + k) / 2 : null;
  });
  const spanB = high.map((_, i) => {
    if (i < 51) return null;
    return (Math.max(...high.slice(i - 51, i + 1)) + Math.min(...low.slice(i - 51, i + 1))) / 2;
  });

  const buy = close.map((c, i) => spanA[i] != null && spanB[i] != null && c > spanA[i] && c > spanB[i] ? 1 : 0);
  const sell = close.map((c, i) => spanA[i] != null && spanB[i] != null && c < spanA[i] && c < spanB[i] ? 1 : 0);

  return { tenkan, kijun, spanA, spanB, buy, sell };
}

// ATR — Average True Range
function calcATR(high, low, close, period = 14) {
  const tr = close.map((c, i) => {
    if (i === 0) return high[i] - low[i];
    const prevC = close[i - 1];
    return Math.max(high[i] - low[i], Math.abs(high[i] - prevC), Math.abs(low[i] - prevC));
  });
  return calcSMA(tr, period);
}

// Z-score normalisation
function calcZScore(arr, w = 20) {
  const sma = calcSMA(arr, w);
  const std = calcSTD(arr, w);
  return arr.map((v, i) => sma[i] != null && std[i] != null && std[i] > 0 ? (v - sma[i]) / std[i] : null);
}

// Returns percent change series
function pctChange(arr, periods = 1) {
  return arr.map((v, i) => i < periods ? null : (v - arr[i - periods]) / arr[i - periods] * 100);
}

// Annualised volatility (rolling std of returns * sqrt(periodsPerYear))
function rollingVol(close, w = 20, periodsPerYear = 252) {
  const ret = pctChange(close, 1).map(v => v != null ? v / 100 : null);
  return calcSTD(ret, w).map(v => v != null ? v * Math.sqrt(periodsPerYear) * 100 : null);
}

// ── Build all indicator signals at once ──────────────────────────

function buildIndicators(data, config = {}) {
  const { close, high, low } = data;
  const {
    rsiPeriod = 14,
    emaSlow = 200,
    emaMed = 100,
    emaFast = 50,
    emaVFast = 25,
    periodsPerYear = 252,   // 252 daily, 52 weekly, ~1638 hourly
  } = config;

  const rsi = calcRSI(close, rsiPeriod);
  const ema200 = calcEMA(close, emaSlow);
  const ema100 = calcEMA(close, emaMed);
  const ema50 = calcEMA(close, emaFast);
  const ema25 = calcEMA(close, emaVFast);
  const { macd, signal: macdSig, hist: macdHist } = calcMACD(close);
  const { sma: bSMA, upper: bUpper, lower: bLower } = calcBollinger(close);
  const ichi = calcIchimoku(high, low, close);
  const atr = calcATR(high, low, close);
  const vol = rollingVol(close, 20, periodsPerYear);

  return {
    rsi,
    rsiBuy: rsi.map(v => v != null && v < 30 ? 1 : 0),
    rsiSell: rsi.map(v => v != null && v > 70 ? 1 : 0),

    ema200, ema100, ema50, ema25,
    e200Buy: close.map((c, i) => ema200[i] != null && c > ema200[i] ? 1 : 0),
    e200Sell: close.map((c, i) => ema200[i] != null && c < ema200[i] ? 1 : 0),
    e100Buy: close.map((c, i) => ema100[i] != null && c > ema100[i] ? 1 : 0),
    e100Sell: close.map((c, i) => ema100[i] != null && c < ema100[i] ? 1 : 0),
    e50Buy: close.map((c, i) => ema50[i] != null && c > ema50[i] ? 1 : 0),
    e50Sell: close.map((c, i) => ema50[i] != null && c < ema50[i] ? 1 : 0),
    e25Buy: close.map((c, i) => ema25[i] != null && c > ema25[i] ? 1 : 0),
    e25Sell: close.map((c, i) => ema25[i] != null && c < ema25[i] ? 1 : 0),

    macd, macdSig, macdHist,
    macdBuy: macdSig.map(v => v != null && v > 0 ? 1 : 0),
    macdSell: macdSig.map(v => v != null && v < 0 ? 1 : 0),

    bSMA, bUpper, bLower,
    bollBuy: close.map((c, i) => bLower[i] != null && c < bLower[i] ? 1 : 0),
    bollSell: close.map((c, i) => bUpper[i] != null && c > bUpper[i] ? 1 : 0),

    ichiSpanA: ichi.spanA,
    ichiSpanB: ichi.spanB,
    ichiBuy: ichi.buy,
    ichiSell: ichi.sell,

    atr, vol,
  };
}

// ── Timeframe-aware indicator config ────────────────────────────

function timeframeConfig(tf) {
  // Returns indicator params tuned per timeframe
  switch (tf) {
    case 'scalp': return { rsiPeriod: 7, emaSlow: 50, emaMed: 20, emaFast: 10, emaVFast: 5, periodsPerYear: 1638 };
    case 'swing': return { rsiPeriod: 14, emaSlow: 100, emaMed: 50, emaFast: 20, emaVFast: 10, periodsPerYear: 252 };
    case 'longterm': return { rsiPeriod: 21, emaSlow: 200, emaMed: 100, emaFast: 50, emaVFast: 25, periodsPerYear: 52 };
    default: return { rsiPeriod: 14, emaSlow: 200, emaMed: 100, emaFast: 50, emaVFast: 25, periodsPerYear: 252 };
  }
}

// ── Default period (months) per timeframe ───────────────────────
function timeframeDefaultPeriod(tf) {
  switch (tf) {
    case 'scalp': return 1;
    case 'swing': return 6;
    case 'longterm': return 24;
    default: return 6;
  }
}

// ── Interval per timeframe ───────────────────────────────────────
function timeframeInterval(tf) {
  switch (tf) {
    case 'scalp': return '1h';
    case 'swing': return '1d';
    case 'longterm': return '1wk';
    default: return '1d';
  }
}
