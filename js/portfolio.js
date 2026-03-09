// ═══════════════════════════════════════════════════════════════
// MORFEO v3 — portfolio.js
// Persistent portfolio management via localStorage
// ═══════════════════════════════════════════════════════════════

const STORAGE_KEY   = 'meridian_portfolio_v3';
const WATCHLIST_KEY = 'meridian_watchlist_v3';
const SETTINGS_KEY  = 'meridian_settings_v3';
const SNAPSHOTS_KEY = 'meridian_snapshots_v1';

// ── Defaults ─────────────────────────────────────────────────────

const DEFAULT_SETTINGS = {
  defaultRisk: 50,      // 0-100
  defaultTimeframe: 'swing',
  defaultPeriod: 6,
  initialBalance: 10000,
  currency: 'USD',
};

// ── Settings ──────────────────────────────────────────────────────

function loadSettings() {
  try {
    const s = localStorage.getItem(SETTINGS_KEY);
    return s ? { ...DEFAULT_SETTINGS, ...JSON.parse(s) } : { ...DEFAULT_SETTINGS };
  } catch (e) { return { ...DEFAULT_SETTINGS }; }
}

function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  scheduleFirestoreSync();
}

// ── Portfolio (held positions) ────────────────────────────────────

function loadPortfolio() {
  try {
    const p = localStorage.getItem(STORAGE_KEY);
    return p ? JSON.parse(p) : [];
  } catch (e) { return []; }
}

function savePortfolio(portfolio) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(portfolio));
  scheduleFirestoreSync();
}


function removePosition(symbol) {
  const portfolio = loadPortfolio().filter(p => p.symbol !== symbol.toUpperCase());
  savePortfolio(portfolio);
  return portfolio;
}

function updatePositionLiveData(symbol, data) {
  const portfolio = loadPortfolio();
  const idx = portfolio.findIndex(p => p.symbol === symbol.toUpperCase());
  if (idx >= 0) {
    portfolio[idx] = { ...portfolio[idx], ...data, lastUpdated: Date.now() };
    savePortfolio(portfolio);
  }
  return portfolio;
}

// ── Watchlist ────────────────────────────────────────────────────

function loadWatchlist() {
  try {
    const w = localStorage.getItem(WATCHLIST_KEY);
    return w ? JSON.parse(w) : [];
  } catch (e) { return []; }
}

function saveWatchlist(list) {
  localStorage.setItem(WATCHLIST_KEY, JSON.stringify(list));
  scheduleFirestoreSync();
}

function addToWatchlist(symbol, name = '') {
  const list = loadWatchlist();
  if (!list.find(w => w.symbol === symbol.toUpperCase())) {
    list.push({ symbol: symbol.toUpperCase(), name, addedAt: Date.now(), currentPrice: null, lastSignal: null });
    saveWatchlist(list);
  }
  return list;
}

function removeFromWatchlist(symbol) {
  const list = loadWatchlist().filter(w => w.symbol !== symbol.toUpperCase());
  saveWatchlist(list);
  return list;
}

// ── Portfolio analytics ───────────────────────────────────────────

function portfolioSummary(portfolio) {
  const withPrice = portfolio.filter(p => p.currentPrice != null);

  const totalCost = portfolio.reduce((s, p) => s + p.shares * p.buyPrice, 0);
  const totalValue = withPrice.reduce((s, p) => s + p.shares * p.currentPrice, 0);
  const totalPnL = totalValue - totalCost;
  const totalPnLPct = totalCost > 0 ? (totalPnL / totalCost) * 100 : 0;

  const buys = portfolio.filter(p => p.lastSignal === 'BUY').length;
  const sells = portfolio.filter(p => p.lastSignal === 'SELL' || p.lastSignal === 'WATCH-SELL').length;
  const holds = portfolio.length - buys - sells;

  return {
    positions: portfolio.length,
    totalCost: Math.round(totalCost * 100) / 100,
    totalValue: Math.round(totalValue * 100) / 100,
    totalPnL: Math.round(totalPnL * 100) / 100,
    totalPnLPct: Math.round(totalPnLPct * 100) / 100,
    buys, sells, holds,
  };
}

// P&L for a single position
function positionPnL(pos) {
  if (!pos.currentPrice) return { pnl: null, pnlPct: null };
  const pnl = (pos.currentPrice - pos.buyPrice) * pos.shares;
  const pnlPct = ((pos.currentPrice - pos.buyPrice) / pos.buyPrice) * 100;
  return {
    pnl: Math.round(pnl * 100) / 100,
    pnlPct: Math.round(pnlPct * 100) / 100,
  };
}

// ── Format helpers ────────────────────────────────────────────────

function fmtCurrency(v, currency = 'USD') {
  if (v == null) return '—';
  const abs = Math.abs(v);
  const str = abs >= 1000
    ? abs.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
    : abs.toFixed(2);
  const sign = v < 0 ? '-' : '';
  const sym = currency === 'USD' ? '$' : currency + ' ';
  return `${sign}${sym}${str}`;
}

function fmtPct(v, decimals = 2) {
  if (v == null) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(decimals)}%`;
}

function fmtDate(dateStr) {
  if (!dateStr) return '—';
  // Use T12:00:00 to avoid UTC midnight shifting date back by one in western timezones
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function signalBadgeClass(sig) {
  if (!sig) return 'badge-neu';
  if (sig === 'BUY' || sig === 'WATCH-BUY') return 'badge-buy';
  if (sig === 'SELL' || sig === 'WATCH-SELL') return 'badge-sell';
  return 'badge-hold';
}

function signalCardClass(sig) {
  if (!sig) return '';
  if (sig === 'BUY' || sig === 'WATCH-BUY') return 'signal-buy';
  if (sig === 'SELL' || sig === 'WATCH-SELL') return 'signal-sell';
  return 'signal-hold';
}

// ── Firestore sync ────────────────────────────────────────────────
// Debounced: writes to Firestore 1.5 s after the last data change.

let _syncTimer = null;

function scheduleFirestoreSync() {
  if (typeof firebase === 'undefined') return;
  const user = firebase.auth?.()?.currentUser;
  if (!user) return;
  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(syncToFirestore, 1500);
}

async function syncToFirestore() {
  const user = typeof firebase !== 'undefined' ? firebase.auth?.()?.currentUser : null;
  if (!user) return;
  try {
    await firebase.firestore().collection('users').doc(user.uid).set({
      portfolio:  loadPortfolio(),
      watchlist:  loadWatchlist(),
      settings:   loadSettings(),
      snapshots:  loadSnapshots(),
      updatedAt:  firebase.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e) {
    console.warn('[Morfeo] Firestore sync failed:', e.message);
  }
}

async function loadUserDataFromFirestore(uid) {
  if (typeof firebase === 'undefined') return;
  try {
    const doc = await firebase.firestore().collection('users').doc(uid).get();
    if (!doc.exists) return;
    const data = doc.data();
    if (Array.isArray(data.portfolio) && data.portfolio.length)
      localStorage.setItem(STORAGE_KEY,   JSON.stringify(data.portfolio));
    if (Array.isArray(data.watchlist) && data.watchlist.length)
      localStorage.setItem(WATCHLIST_KEY, JSON.stringify(data.watchlist));
    if (data.settings && typeof data.settings === 'object')
      localStorage.setItem(SETTINGS_KEY,  JSON.stringify(data.settings));
    if (Array.isArray(data.snapshots) && data.snapshots.length)
      localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(data.snapshots));
  } catch (e) {
    console.warn('[Morfeo] Could not load Firestore data:', e.message);
  }
}

// ── Portfolio value snapshots ──────────────────────────────────────

function savePortfolioSnapshot(totalValue) {
  if (!totalValue || totalValue <= 0) return;
  const today = new Date().toISOString().split('T')[0];
  const snapshots = loadSnapshots();
  const idx = snapshots.findIndex(s => s.date === today);
  const value = Math.round(totalValue * 100) / 100;
  if (idx >= 0) snapshots[idx].value = value;
  else snapshots.push({ date: today, value });
  if (snapshots.length > 365) snapshots.splice(0, snapshots.length - 365);
  try { localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(snapshots)); } catch (e) {}
  scheduleFirestoreSync();
}

function loadSnapshots() {
  try {
    const s = localStorage.getItem(SNAPSHOTS_KEY);
    return s ? JSON.parse(s) : [];
  } catch { return []; }
}
