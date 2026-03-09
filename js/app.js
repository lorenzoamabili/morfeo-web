// ═══════════════════════════════════════════════════════════════
// MORFEO v3 — app.js
// UI controller, view routing, event handling
// ═══════════════════════════════════════════════════════════════

// ── App state ────────────────────────────────────────────────────
const state = {
  currentView: 'analysis',
  analysisResult: null,   // last analysis data
  portfolio: [],
  watchlist: [],
  settings: null,
  portfolioCache: {},     // symbol → { data, ind, net, result }
};

// ── Init ─────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  await initAuth();

  state.settings = loadSettings();
  state.portfolio = loadPortfolio();
  state.watchlist = loadWatchlist();

  initNav();
  initAnalysisView();
  renderDashboard();
  renderPortfolioView();
  renderWatchlistView();
  renderSettingsView();
  updatePortfolioBadge();
  updateWatchlistBadge();
  startClock();

  setupWatchlistAutocomplete();
  setupPortfolioAddAutocomplete();

  // Mobile menu
  document.getElementById('menuToggle')?.addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
  });
});

// ── Navigation ────────────────────────────────────────────────────

function initNav() {
  document.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', () => {
      const view = el.dataset.view;
      if (view) switchView(view);
      document.getElementById('sidebar').classList.remove('open');
    });
  });
}

function switchView(name) {
  state.currentView = name;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${name}`)?.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.view === name);
  });
  const titles = {
    dashboard: 'Dashboard',
    analysis: 'Signal Analysis',
    portfolio: 'Portfolio',
    watchlist: 'Watchlist',
    settings: 'Settings',
  };
  document.getElementById('topbarTitle').textContent = titles[name] || 'Morfeo';

  // Refresh views on switch
  if (name === 'dashboard') renderDashboard();
  if (name === 'portfolio') renderPortfolioView();
  if (name === 'watchlist') renderWatchlistView();
}

// ── Clock ─────────────────────────────────────────────────────────

function startClock() {
  function tick() {
    const el = document.getElementById('topbarTime');
    if (el) el.textContent = new Date().toUTCString().replace('GMT', 'UTC').substring(0, 25);
  }
  tick();
  setInterval(tick, 1000);
}

// ══════════════════════════════════════════════════════════════════
// ANALYSIS VIEW
// ══════════════════════════════════════════════════════════════════

function initAnalysisView() {
  const s = state.settings;

  // Populate defaults
  document.getElementById('aMonths').value = s.defaultPeriod;
  document.getElementById('aRiskSlider').value = s.defaultRisk;
  updateRiskLabel(s.defaultRisk);

  // Timeframe segment — clear all first, then set correct default
  document.querySelectorAll('#tfSegment .seg-btn').forEach(btn => {
    btn.classList.remove('active');
    btn.addEventListener('click', () => {
      document.querySelectorAll('#tfSegment .seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tf = btn.dataset.tf;
      document.getElementById('aMonths').value = timeframeDefaultPeriod(tf);
    });
  });
  // Set correct default (fall back to 'swing' if not found)
  const defaultBtn = document.querySelector(`#tfSegment [data-tf="${s.defaultTimeframe}"]`)
    || document.querySelector('#tfSegment [data-tf="swing"]');
  if (defaultBtn) defaultBtn.classList.add('active');

  // Risk slider
  document.getElementById('aRiskSlider')?.addEventListener('input', e => {
    updateRiskLabel(parseInt(e.target.value));
  });

  // Buy date default
  const today = new Date().toISOString().split('T')[0];
  const buyInput = document.getElementById('aBuyDate');
  if (buyInput) { buyInput.value = today; buyInput.max = today; }

  // Enter key + ticker autocomplete
  setupTickerAutocomplete();
}

// ── Autocomplete (generic) ────────────────────────────────────────

function setupAutocomplete(inputId, dropdownId, onEnter) {
  const input    = document.getElementById(inputId);
  const dropdown = document.getElementById(dropdownId);
  if (!input || !dropdown) return;

  let debounceTimer = null;
  let activeIdx     = -1;

  input.addEventListener('keydown', e => {
    const items = dropdown.querySelectorAll('.ticker-item');
    if (e.key === 'Enter') {
      if (activeIdx >= 0 && items[activeIdx]) {
        e.preventDefault();
        items[activeIdx].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      } else {
        _hideDropdown(dropdown);
        if (onEnter) onEnter();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIdx = Math.min(activeIdx + 1, items.length - 1);
      items.forEach((el, i) => el.classList.toggle('ticker-item-active', i === activeIdx));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIdx = Math.max(activeIdx - 1, -1);
      items.forEach((el, i) => el.classList.toggle('ticker-item-active', i === activeIdx));
      return;
    }
    if (e.key === 'Escape') { _hideDropdown(dropdown); return; }
  });

  input.addEventListener('input', () => {
    const lastSeg = input.value.split(',').pop().trim();
    clearTimeout(debounceTimer);
    activeIdx = -1;
    if (lastSeg.length < 2) { _hideDropdown(dropdown); return; }
    debounceTimer = setTimeout(() => _fetchDropdownSuggestions(lastSeg, input, dropdown), 380);
  });

  input.addEventListener('blur', () => {
    setTimeout(() => _hideDropdown(dropdown), 200);
  });
}

async function _fetchDropdownSuggestions(query, input, dropdown) {
  dropdown.innerHTML = '<div class="ticker-searching">Searching…</div>';
  dropdown.style.display = 'block';
  try {
    const results = await searchYahooTickers(query);
    _renderDropdown(results, input, dropdown);
  } catch {
    _hideDropdown(dropdown);
  }
}

function _renderDropdown(results, input, dropdown) {
  if (!results.length) {
    dropdown.innerHTML = '<div class="ticker-searching">No results found</div>';
    return;
  }
  const typeLabel = { EQUITY: 'Stock', ETF: 'ETF', MUTUALFUND: 'Fund', CRYPTOCURRENCY: 'Crypto', INDEX: 'Index', FUTURE: 'Future' };
  dropdown.innerHTML = results.map(r => {
    const name = r.shortname || r.longname || '';
    const exch = r.exchange || '';
    const type = typeLabel[r.quoteType] || r.quoteType || '';
    return `
      <div class="ticker-item" data-symbol="${r.symbol}">
        <span class="ticker-item-symbol">${r.symbol}</span>
        <span class="ticker-item-name">${name}</span>
        <span class="ticker-item-meta">${[exch, type].filter(Boolean).join(' · ')}</span>
      </div>`;
  }).join('');
  dropdown.style.display = 'block';
  dropdown.querySelectorAll('.ticker-item').forEach(item => {
    item.addEventListener('mousedown', e => {
      e.preventDefault();
      const symbol = item.dataset.symbol;
      const parts = input.value.split(',');
      parts[parts.length - 1] = symbol;
      input.value = parts.join(', ');
      _hideDropdown(dropdown);
    });
  });
}

function _hideDropdown(dropdown) {
  if (dropdown) dropdown.style.display = 'none';
}

function setupTickerAutocomplete() {
  setupAutocomplete('aSymbol', 'aSymbolDropdown', runAnalysis);
}

function setupWatchlistAutocomplete() {
  setupAutocomplete('wAddInput', 'wAddDropdown', addWatchlistManual);
}

function setupPortfolioAddAutocomplete() {
  setupAutocomplete('pAddSymbol', 'pAddSymbolDropdown', addPositionManual);
}

function updateRiskLabel(val) {
  const profile = riskProfile(val);
  const el = document.getElementById('aRiskLabel');
  if (el) {
    el.textContent = profile.label;
    el.style.color = profile.color;
  }
  const descEl = document.getElementById('aRiskDesc');
  if (descEl) descEl.textContent = profile.desc;
}

function getActiveTimeframe() {
  const active = document.querySelector('#tfSegment .seg-btn.active');
  return active ? active.dataset.tf : 'swing';
}

async function runAnalysis() {
  const symbol = document.getElementById('aSymbol').value.trim().toUpperCase();
  const months = parseInt(document.getElementById('aMonths').value) || 6;
  const rawDate = document.getElementById('aBuyDate').value;
  const riskVal = parseInt(document.getElementById('aRiskSlider').value);
  const tf = getActiveTimeframe();
  const riskLvl = riskVal / 100;

  // Weekend check
  const buyDate = rawDate ? adjustWeekend(rawDate) : null;
  const weekendEl = document.getElementById('aWeekendWarn');
  if (rawDate && buyDate !== rawDate) {
    weekendEl.textContent = `Weekend adjusted → ${buyDate}`;
    weekendEl.style.display = 'block';
  } else {
    weekendEl.style.display = 'none';
  }

  if (!symbol) { showAlert('aAlert', 'error', 'Please enter a ticker symbol.'); return; }

  const btn = document.getElementById('aRunBtn');
  btn.disabled = true;
  hideAlert('aAlert');
  document.getElementById('aResults').style.display = 'none';
  setLoadingSteps('aLoading', true);
  setStep('aLoading', 1);

  try {
    // ── Fetch data ──
    const now = Math.floor(Date.now() / 1000);
    const startDt = new Date();
    startDt.setMonth(startDt.getMonth() - months);
    const period1 = Math.floor(startDt.getTime() / 1000);
    const interval = timeframeInterval(tf);

    const data = await fetchYahooOHLCV(symbol, period1, now, interval);
    setStep('aLoading', 2);

    // ── Fetch fundamentals in parallel ──
    const fundsPromise = fetchFundamentals(symbol);

    // ── Indicators ──
    const config = timeframeConfig(tf);
    const ind = buildIndicators(data, config);
    setStep('aLoading', 3);

    // ── Optimise ──
    const buyDayIdx = buyDate ? (data.dates.findIndex(d => d >= buyDate) ?? -1) : -1;
    const slPct = suggestStopLoss(data.close, ind.atr, riskLvl) / 100;
    const posSzPct = suggestPositionSize(riskLvl) / 100;

    const { bestWeights, bestSignal, bestProfit } = await optimise(data.close, ind, {
      nTrials: 400,
      buyDayIdx,
      riskLevel: riskLvl,
      backtestOpts: { stopLossPct: slPct, positionSizePct: posSzPct },
    });

    setStep('aLoading', 4);

    // ── Final backtest ──
    const result = backtest(data.close, bestSignal, {
      riskLevel: riskLvl,
      stopLossPct: slPct,
      takeProfitPct: null,
      positionSizePct: posSzPct,
      initialBalance: state.settings.initialBalance,
    });

    const bah = buyAndHold(data.close, state.settings.initialBalance);
    const lastRSI = ind.rsi.filter(v => v != null).pop();
    const signal = currentSignal(bestSignal, lastRSI, riskLvl);
    const funds = await fundsPromise;

    // Cache for later portfolio use
    state.analysisResult = { data, ind, net: bestSignal, result, bah, signal, funds, riskLvl, tf, bestWeights, symbol };
    state.portfolioCache[symbol] = state.analysisResult;

    setLoadingSteps('aLoading', false);

    // ── Render results ──
    renderAnalysisResults(state.analysisResult, buyDate);

  } catch (err) {
    setLoadingSteps('aLoading', false);
    showAlert('aAlert', 'error', err.message || 'Analysis failed.');
  } finally {
    btn.disabled = false;
  }
}

function renderAnalysisResults(r, buyDate) {
  const { data, ind, net, result, bah, signal, funds, riskLvl, tf, bestWeights, symbol } = r;

  const resEl = document.getElementById('aResults');
  resEl.style.display = 'block';

  // Header
  document.getElementById('aResTicker').textContent = symbol;
  document.getElementById('aResName').textContent = data.name !== symbol ? data.name : '';
  document.getElementById('aResExchange').textContent = data.exchange;

  // Signal badge
  const sigEl = document.getElementById('aResSignal');
  sigEl.textContent = signal;
  sigEl.className = 'badge ' + signalBadgeClass(signal);

  // Stats
  const profitEl = document.getElementById('aResProfit');
  profitEl.textContent = fmtPct(result.profitPct);
  profitEl.className = 'stat-value ' + (result.profitPct >= 0 ? 'pos' : 'neg');

  document.getElementById('aResBah').textContent = fmtPct(bah);
  document.getElementById('aResWinRate').textContent = result.numTrades ? `${result.winRate}%` : '—';
  document.getElementById('aResWinRate2').textContent = result.numTrades ? `${result.winRate}%` : '—';
  document.getElementById('aResDrawdown').textContent = result.maxDrawdownPct > 0 ? `-${result.maxDrawdownPct}%` : '—';
  document.getElementById('aResTrades').textContent = result.numTrades;

  const lastPrice = data.close[data.close.length - 1];
  document.getElementById('aResPrice').textContent = `${data.currency} ${lastPrice.toFixed(2)}`;

  const atrLast = ind.atr.filter(v => v != null).pop();
  const slSugg = suggestStopLoss(data.close, ind.atr, riskLvl);
  const posSugg = suggestPositionSize(riskLvl);
  document.getElementById('aResStopLoss').textContent = `${slSugg}%  (${(lastPrice * slSugg / 100).toFixed(2)})`;
  document.getElementById('aResPosSize').textContent = `${posSugg}% of balance`;

  const lastVol = ind.vol.filter(v => v != null).pop();
  document.getElementById('aResVol').textContent = lastVol ? `${lastVol.toFixed(1)}%` : '—';
  document.getElementById('aResATR').textContent = atrLast ? `${atrLast.toFixed(2)} (${(atrLast / lastPrice * 100).toFixed(1)}%)` : '—';

  // Fundamentals
  if (funds) {
    document.getElementById('aFundPE').textContent = funds.pe;
    document.getElementById('aFundFwdPE').textContent = funds.forwardPE;
    document.getElementById('aFundEPS').textContent = funds.eps;
    document.getElementById('aFundMktCap').textContent = funds.marketCap;
    document.getElementById('aFundBeta').textContent = funds.beta;
    document.getElementById('aFundDivYield').textContent = funds.dividendYield;
    document.getElementById('aFund52H').textContent = funds.fiftyTwoHigh;
    document.getElementById('aFund52L').textContent = funds.fiftyTwoLow;
    document.getElementById('aFundAvgVol').textContent = funds.avgVolume;
    document.getElementById('aFundamentals').style.display = 'block';
  } else {
    document.getElementById('aFundamentals').style.display = 'none';
  }

  // Weights
  renderWeightBars('aWeights', bestWeights);

  // Charts
  renderAnalysisChart('aChartMain', data, ind, net, { buyDateStr: buyDate });
  renderMACDChart('aChartMACD', data, ind);
  renderRSIChart('aChartRSI', data, ind);
  renderVolatilityChart('aChartVol', data.dates, ind.vol, ind.atr, data.close);

  // Add to portfolio / watchlist buttons
  document.getElementById('aBtnAddPortfolio').onclick = () => {
    document.getElementById('pAddSymbol').value = symbol;
    switchView('portfolio');
    setTimeout(() => document.getElementById('pAddShares')?.focus(), 100);
  };
  document.getElementById('aBtnAddWatchlist').onclick = () => {
    addToWatchlist(symbol, data.name);
    state.watchlist = loadWatchlist();
    showToast(`${symbol} added to watchlist`);
    updateWatchlistBadge();
  };

  resEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderWeightBars(containerId, weights) {
  const labels = { rsiW: 'RSI', trendW: 'EMA Trend', macdW: 'MACD', bollW: 'Bollinger', ichiW: 'Ichimoku' };
  const container = document.getElementById(containerId);
  if (!container) return;

  const maxAbs = Math.max(...Object.values(weights).map(Math.abs));
  container.innerHTML = Object.entries(weights).map(([k, v]) => {
    const pct = maxAbs > 0 ? Math.abs(v) / maxAbs * 100 : 0;
    const sign = v >= 0 ? '+' : '';
    return `
      <div class="weight-row">
        <div class="weight-name">${labels[k] || k}</div>
        <div class="weight-bar-bg"><div class="weight-bar-fill" style="width:${pct}%"></div></div>
        <div class="weight-pct">${sign}${(v * 100).toFixed(0)}%</div>
      </div>`;
  }).join('');
}

// ── Add position (manual, from portfolio header) ──────────────────

async function addPositionManual() {
  const symbolInput = document.getElementById('pAddSymbol');
  const sharesInput = document.getElementById('pAddShares');
  const dateInput   = document.getElementById('pAddDate');
  const sym    = symbolInput.value.trim().toUpperCase();
  const shares = parseFloat(sharesInput.value);
  const buyDate = dateInput?.value || null; // null = no date specified

  if (!sym)              { showToast('Enter a ticker symbol', 'error'); return; }
  if (!shares || shares <= 0) { showToast('Enter a valid number of shares', 'error'); return; }

  showToast(`Adding ${sym}…`);

  // Fetch current price — quote API first, OHLCV last-close as fallback
  let buyPrice = null;
  let name = sym;

  try {
    const r = await fetch(`/api/quote?symbol=${encodeURIComponent(sym)}`);
    if (r.ok) {
      const json = await r.json();
      const q = json?.quoteResponse?.result?.[0];
      if (q) {
        // regularMarketPrice is null when market is closed; use previous close
        buyPrice = q.regularMarketPrice || q.regularMarketPreviousClose || q.ask || null;
        name = q.longName || q.shortName || sym;
      }
    }
  } catch (e) { }

  // Secondary fallback: last close from OHLCV
  if (!buyPrice) {
    try {
      const now   = Math.floor(Date.now() / 1000);
      const start = now - 7 * 24 * 3600;
      const r = await fetch(`/api/ohlcv?symbol=${encodeURIComponent(sym)}&period1=${start}&period2=${now}&interval=1d`);
      if (r.ok) {
        const json = await r.json();
        const closes = json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
        if (closes) buyPrice = [...closes].reverse().find(v => v != null) ?? null;
        const meta = json?.chart?.result?.[0]?.meta;
        if (meta) name = meta.longName || meta.shortName || sym;
      }
    } catch (e) { }
  }

  if (!buyPrice) {
    showToast(`Could not fetch price for ${sym} — check the symbol`, 'error');
    return;
  }

  const portfolio = loadPortfolio();
  const idx = portfolio.findIndex(p => p.symbol === sym);
  const entry = { symbol: sym, name, shares, buyPrice, buyDate: buyDate || null, addedAt: Date.now(), currentPrice: buyPrice, lastSignal: null, lastUpdated: Date.now() };
  if (idx >= 0) portfolio[idx] = { ...portfolio[idx], ...entry };
  else portfolio.push(entry);
  savePortfolio(portfolio);

  state.portfolio = loadPortfolio();
  symbolInput.value = '';
  sharesInput.value = '';
  if (dateInput) dateInput.value = '';
  _hideDropdown(document.getElementById('pAddSymbolDropdown'));
  renderPortfolioView();
  renderDashboard();
  updatePortfolioBadge();
  showToast(`${sym} added — ${shares} shares @ ${fmtCurrency(buyPrice)}`);
}

// ══════════════════════════════════════════════════════════════════
// DASHBOARD VIEW
// ══════════════════════════════════════════════════════════════════

function renderDashboard() {
  state.portfolio = loadPortfolio();
  state.watchlist = loadWatchlist();

  const summary = portfolioSummary(state.portfolio);
  const currency = state.settings?.currency || 'USD';

  document.getElementById('dTotalValue').textContent = fmtCurrency(summary.totalValue || 0, currency);
  document.getElementById('dTotalPnL').textContent = fmtPct(summary.totalPnLPct);
  document.getElementById('dTotalPnL').className = 'stat-value ' + (summary.totalPnLPct >= 0 ? 'pos' : 'neg');
  document.getElementById('dPositions').textContent = summary.positions;
  document.getElementById('dBuys').textContent = summary.buys;
  document.getElementById('dSells').textContent = summary.sells;
  document.getElementById('dWatchlist').textContent = state.watchlist.length;

  // Recent signals
  const signalEl = document.getElementById('dSignalList');
  const allPos = [...state.portfolio].filter(p => p.lastSignal);
  const alertPos = allPos.filter(p => p.lastSignal === 'BUY' || p.lastSignal === 'SELL');

  if (alertPos.length === 0) {
    signalEl.innerHTML = `<div class="empty-state"><div class="empty-icon">📡</div><div>No active signals. Run analysis on your positions to populate.</div></div>`;
  } else {
    signalEl.innerHTML = alertPos.slice(0, 8).map(p => `
      <div class="flex items-center justify-between" style="padding:10px 0; border-bottom:1px solid var(--border);">
        <div>
          <span class="font-serif" style="font-size:15px; font-weight:700;">${p.symbol}</span>
          <span class="text-muted text-xs" style="margin-left:8px;">${p.name}</span>
        </div>
        <div class="flex gap-8 items-center">
          <span class="text-xs text-muted">${p.currentPrice ? fmtCurrency(p.currentPrice) : '—'}</span>
          <span class="badge ${signalBadgeClass(p.lastSignal)}">${p.lastSignal}</span>
        </div>
      </div>`).join('');
  }

  // Portfolio positions mini-list
  const posListEl = document.getElementById('dPosList');
  if (state.portfolio.length === 0) {
    posListEl.innerHTML = `<div class="empty-state"><div class="empty-icon">💼</div><div class="empty-title">Portfolio is empty</div><div>Analyse a stock then click "Add to Portfolio"</div></div>`;
  } else {
    posListEl.innerHTML = state.portfolio.slice(0, 6).map(p => {
      const { pnl, pnlPct } = positionPnL(p);
      return `
        <div class="flex items-center justify-between" style="padding:9px 0; border-bottom:1px solid var(--border);">
          <div>
            <span style="font-weight:500; font-size:12px;">${p.symbol}</span>
            <span class="text-muted text-xs" style="margin-left:6px;">${p.shares} sh @ ${fmtCurrency(p.buyPrice)}</span>
          </div>
          <div class="flex gap-8 items-center">
            <span class="text-xs ${pnlPct >= 0 ? 'text-green' : 'text-red'}">${fmtPct(pnlPct)}</span>
          </div>
        </div>`;
    }).join('');
  }
}

// ══════════════════════════════════════════════════════════════════
// PORTFOLIO VIEW
// ══════════════════════════════════════════════════════════════════

function renderPortfolioView() {
  state.portfolio = loadPortfolio();
  const summary  = portfolioSummary(state.portfolio);
  const currency = state.settings?.currency || 'USD';

  document.getElementById('pTotalValue').textContent = fmtCurrency(summary.totalValue || 0, currency);
  document.getElementById('pTotalPnL').textContent   = (summary.totalPnL >= 0 ? '+' : '') + fmtCurrency(summary.totalPnL);
  document.getElementById('pTotalPnL').className     = 'stat-value ' + (summary.totalPnL >= 0 ? 'pos' : 'neg');
  const pnlPctEl = document.getElementById('pTotalPnLPct');
  if (pnlPctEl) pnlPctEl.textContent = fmtPct(summary.totalPnLPct);
  document.getElementById('pPositionCount').textContent = summary.positions;

  const tbody = document.getElementById('pList');
  if (state.portfolio.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty-state" style="text-align:center;padding:40px;">
      <div class="empty-icon">💼</div>
      <div class="empty-title">Portfolio is empty</div>
      <div>Enter a ticker and number of shares above, then click Add.</div>
    </td></tr>`;
    return;
  }

  tbody.innerHTML = state.portfolio.map(p => {
    const { pnl, pnlPct } = positionPnL(p);
    return `
      <tr>
        <td><span style="font-weight:500;">${p.symbol}</span></td>
        <td class="text-muted text-xs">${p.name || '—'}</td>
        <td>${p.shares.toLocaleString()}</td>
        <td>${fmtCurrency(p.buyPrice)}</td>
        <td>${p.currentPrice ? fmtCurrency(p.currentPrice) : '—'}</td>
        <td class="${pnlPct != null ? (pnlPct >= 0 ? 'text-green' : 'text-red') : ''}">
          ${pnlPct != null ? fmtPct(pnlPct) + '<br><span style="font-size:10px;opacity:.7;">' + (pnl >= 0 ? '+' : '') + fmtCurrency(pnl) + '</span>' : '—'}
        </td>
        <td>${p.lastSignal ? `<span class="badge ${signalBadgeClass(p.lastSignal)}">${p.lastSignal}</span>` : '—'}</td>
        <td class="text-xs text-muted">${p.buyDate ? fmtDate(p.buyDate) : (p.addedAt ? timeAgo(p.addedAt) : '—')}</td>
        <td>
          <div class="flex gap-8">
            <button class="btn btn-ghost btn-xs" onclick="refreshPosition('${p.symbol}')" title="Update price">↻</button>
            <button class="btn btn-ghost btn-xs" onclick="analyseFromWatchlist('${p.symbol}')">Analyse</button>
            <button class="btn btn-danger btn-xs" onclick="removePos('${p.symbol}')">✕ Sell</button>
          </div>
        </td>
      </tr>`;
  }).join('');
}

async function refreshPosition(symbol) {
  try {
    const r = await fetch(`/api/quote?symbol=${encodeURIComponent(symbol)}`);
    if (!r.ok) throw new Error('Quote fetch failed');
    const json = await r.json();
    const q = json?.quoteResponse?.result?.[0];
    if (!q) throw new Error('No quote data');

    updatePositionLiveData(symbol, {
      currentPrice: q.regularMarketPrice,
      name: q.longName || q.shortName || symbol,
    });
    state.portfolio = loadPortfolio();
    renderPortfolioView();
    renderDashboard();
    showToast(`${symbol} → ${fmtCurrency(q.regularMarketPrice)}`);
  } catch (e) {
    showToast(`Failed to refresh ${symbol}: ${e.message}`, 'error');
  }
}

async function refreshAllPositions() {
  const btn = document.getElementById('pRefreshAll');
  if (btn) btn.disabled = true;
  const positions = loadPortfolio();
  for (const p of positions) {
    await refreshPosition(p.symbol);
    await new Promise(r => setTimeout(r, 300));
  }
  if (btn) btn.disabled = false;
  showToast('All positions updated');
}

function removePos(symbol) {
  if (!confirm(`Remove ${symbol} from portfolio?`)) return;
  removePosition(symbol);
  state.portfolio = loadPortfolio();
  renderPortfolioView();
  renderDashboard();
  updatePortfolioBadge();
  showToast(`${symbol} removed`);
}

// ══════════════════════════════════════════════════════════════════
// WATCHLIST VIEW
// ══════════════════════════════════════════════════════════════════

function renderWatchlistView() {
  state.watchlist = loadWatchlist();
  const container = document.getElementById('wList');

  if (state.watchlist.length === 0) {
    container.innerHTML = `<tr><td colspan="6" class="empty-state" style="text-align:center;padding:40px;">
      <div class="empty-icon">👁</div>
      <div class="empty-title">Watchlist is empty</div>
      <div>Add symbols from the Analysis view or enter one below.</div>
    </td></tr>`;
    return;
  }

  container.innerHTML = state.watchlist.map(w => `
    <tr>
      <td><span style="font-weight:500;">${w.symbol}</span></td>
      <td class="text-muted text-xs">${w.name || '—'}</td>
      <td>${w.currentPrice ? fmtCurrency(w.currentPrice) : '—'}</td>
      <td>${w.lastSignal ? `<span class="badge ${signalBadgeClass(w.lastSignal)}">${w.lastSignal}</span>` : '—'}</td>
      <td class="text-xs text-muted">${w.lastUpdated ? timeAgo(w.lastUpdated) : '—'}</td>
      <td>
        <div class="flex gap-8">
          <button class="btn btn-ghost btn-xs" onclick="analyseFromWatchlist('${w.symbol}')">Analyse</button>
          <button class="btn btn-danger btn-xs" onclick="removeWatch('${w.symbol}')">✕</button>
        </div>
      </td>
    </tr>`).join('');
}

function addWatchlistManual() {
  const input = document.getElementById('wAddInput');
  const syms = input.value.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  if (!syms.length) return;
  syms.forEach(sym => addToWatchlist(sym));
  state.watchlist = loadWatchlist();
  input.value = '';
  _hideDropdown(document.getElementById('wAddDropdown'));
  renderWatchlistView();
  updateWatchlistBadge();
  showToast(syms.length > 1 ? `${syms.length} symbols added to watchlist` : `${syms[0]} added to watchlist`);
}

function removeWatch(symbol) {
  removeFromWatchlist(symbol);
  state.watchlist = loadWatchlist();
  renderWatchlistView();
  updateWatchlistBadge();
}

function analyseFromWatchlist(symbol) {
  document.getElementById('aSymbol').value = symbol;
  switchView('analysis');
  setTimeout(() => runAnalysis(), 100);
}

async function refreshWatchlist() {
  const btn = document.getElementById('wRefreshBtn');
  if (btn) btn.disabled = true;
  for (const w of state.watchlist) {
    try {
      const now = Math.floor(Date.now() / 1000);
      const start = now - 30 * 24 * 3600;
      const data = await fetchYahooOHLCV(w.symbol, start, now, '1d');
      const ind = buildIndicators(data);
      const { bestSignal } = await optimise(data.close, ind, { nTrials: 100 });
      const lastRSI = ind.rsi.filter(v => v != null).pop();
      const signal = currentSignal(bestSignal, lastRSI, 0.5);
      const list = loadWatchlist();
      const idx = list.findIndex(l => l.symbol === w.symbol);
      if (idx >= 0) {
        list[idx].currentPrice = data.close[data.close.length - 1];
        list[idx].lastSignal = signal;
        list[idx].name = data.name;
        list[idx].lastUpdated = Date.now();
        saveWatchlist(list);
      }
      await new Promise(r => setTimeout(r, 400));
    } catch (e) { /* skip failed tickers */ }
  }
  state.watchlist = loadWatchlist();
  renderWatchlistView();
  if (btn) btn.disabled = false;
  showToast('Watchlist refreshed');
}

// ══════════════════════════════════════════════════════════════════
// SETTINGS VIEW
// ══════════════════════════════════════════════════════════════════

function renderSettingsView() {
  const s = state.settings;
  document.getElementById('sDefaultRisk').value = s.defaultRisk;
  document.getElementById('sDefaultTf').value = s.defaultTimeframe;
  document.getElementById('sDefaultPeriod').value = s.defaultPeriod;
  document.getElementById('sInitialBalance').value = s.initialBalance;
}

function saveSettingsForm() {
  const s = {
    defaultRisk: parseInt(document.getElementById('sDefaultRisk').value),
    defaultTimeframe: document.getElementById('sDefaultTf').value,
    defaultPeriod: parseInt(document.getElementById('sDefaultPeriod').value),
    initialBalance: parseFloat(document.getElementById('sInitialBalance').value),
    currency: state.settings.currency,
  };
  saveSettings(s);
  state.settings = s;
  showAlert('sAlert', 'ok', 'Settings saved.');
  setTimeout(() => hideAlert('sAlert'), 2500);
}

function clearAllData() {
  if (!confirm('Clear all portfolio, watchlist and settings data? This cannot be undone.')) return;
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(WATCHLIST_KEY);
  localStorage.removeItem(SETTINGS_KEY);
  state.portfolio = [];
  state.watchlist = [];
  state.settings  = loadSettings();
  state.portfolioCache = {};
  // Also wipe Firestore document for this user
  const user = typeof firebase !== 'undefined' ? firebase.auth?.()?.currentUser : null;
  if (user) {
    firebase.firestore().collection('users').doc(user.uid).delete().catch(() => {});
  }
  renderDashboard();
  renderPortfolioView();
  renderWatchlistView();
  renderSettingsView();
  updatePortfolioBadge();
  updateWatchlistBadge();
  showToast('All data cleared');
}

// ══════════════════════════════════════════════════════════════════
// UTILITIES
// ══════════════════════════════════════════════════════════════════

function adjustWeekend(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay();
  if (day === 6) d.setDate(d.getDate() - 1);
  if (day === 0) d.setDate(d.getDate() - 2);
  return d.toISOString().split('T')[0];
}

function showAlert(id, type, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = `alert alert-${type} show`;
  el.textContent = msg;
}
function hideAlert(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('show');
}

let toastTimer;
function showToast(msg, type = 'ok') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = `toast toast-${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

function setLoadingSteps(id, show) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle('active', show);
  if (!show) {
    el.querySelectorAll('.step').forEach(s => s.classList.remove('active', 'done'));
  }
}

function setStep(loadingId, stepNum) {
  const el = document.getElementById(loadingId);
  if (!el) return;
  el.querySelectorAll('.step').forEach((s, i) => {
    if (i < stepNum - 1) { s.classList.add('done'); s.classList.remove('active'); s.querySelector('.step-bullet').textContent = '✓'; }
    else if (i === stepNum - 1) { s.classList.add('active'); s.classList.remove('done'); }
    else { s.classList.remove('active', 'done'); }
  });
}

function updatePortfolioBadge() {
  const badge = document.getElementById('portfolioBadge');
  const n = loadPortfolio().length;
  if (badge) badge.textContent = n;
}

function updateWatchlistBadge() {
  const badge = document.getElementById('watchlistBadge');
  const n = loadWatchlist().length;
  if (badge) badge.textContent = n;
}

function timeAgo(ts) {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// Export CSV
function exportPortfolioCSV() {
  const portfolio = loadPortfolio();
  if (!portfolio.length) { showToast('Portfolio is empty', 'error'); return; }

  const headers = ['Symbol', 'Name', 'Shares', 'Buy Price', 'Buy Date', 'Current Price', 'P&L%', 'Signal', 'Timeframe', 'Risk Level'];
  const rows = portfolio.map(p => {
    const { pnlPct } = positionPnL(p);
    return [
      p.symbol, p.name, p.shares, p.buyPrice, p.buyDate,
      p.currentPrice || '', pnlPct != null ? pnlPct.toFixed(2) + '%' : '',
      p.lastSignal || '', p.timeframe, riskProfile(p.riskLevel || 50).label
    ];
  });

  const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `morfeo-portfolio-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  showToast('Portfolio exported');
}

// ── Backup export / import ────────────────────────────────────────

function exportData() {
  const backup = {
    version: 1,
    exportedAt: new Date().toISOString(),
    portfolio: localStorage.getItem(STORAGE_KEY),
    watchlist: localStorage.getItem(WATCHLIST_KEY),
    settings:  localStorage.getItem(SETTINGS_KEY),
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `morfeo-backup-${new Date().toISOString().split('T')[0]}.json`;
  a.click();
  showToast('Backup exported');
}

function importData(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const backup = JSON.parse(e.target.result);
      if (backup.portfolio) localStorage.setItem(STORAGE_KEY,   backup.portfolio);
      if (backup.watchlist) localStorage.setItem(WATCHLIST_KEY, backup.watchlist);
      if (backup.settings)  localStorage.setItem(SETTINGS_KEY,  backup.settings);
      state.portfolio = loadPortfolio();
      state.watchlist = loadWatchlist();
      state.settings  = loadSettings();
      renderDashboard();
      renderPortfolioView();
      renderWatchlistView();
      renderSettingsView();
      updatePortfolioBadge();
      updateWatchlistBadge();
      showToast('Backup restored');
    } catch {
      showToast('Invalid backup file', 'error');
    }
    event.target.value = '';
  };
  reader.readAsText(file);
}
