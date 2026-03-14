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
  portfolioSort: { col: null, dir: 'asc' },
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
  startAutoSignalRefresh();

  // Fetch live USD→EUR rate, then re-render once available
  fetchUsdEurRate().then(() => { renderDashboard(); renderPortfolioView(); });

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

  // Buy date — no default, cap at today
  const buyInput = document.getElementById('aBuyDate');
  if (buyInput) buyInput.max = new Date().toISOString().split('T')[0];

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
  const consensusCard = document.getElementById('aConsensusCard');
  if (consensusCard) consensusCard.style.display = 'none';
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

    // ── Multi-timeframe consensus (runs in background, updates card when ready) ──
    runConsensusAnalysis(data).then(renderConsensusResults);

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
  sigEl.title = explainSignal(signal);

  // Stats
  const profitEl = document.getElementById('aResProfit');
  profitEl.textContent = fmtPct(result.profitPct);
  profitEl.className = 'stat-value ' + (result.profitPct >= 0 ? 'pos' : 'neg');

  // Tooltips to help interpret key stats
  profitEl.title = 'Total return of the optimised strategy over the backtest period.';

  const bahEl = document.getElementById('aResBah');
  bahEl.textContent = fmtPct(bah);
  bahEl.title = 'Buy & hold return over the same period (no timing, just holding).';

  const winRateEl = document.getElementById('aResWinRate');
  winRateEl.textContent = result.numTrades ? `${result.winRate}%` : '—';
  winRateEl.title = 'Percentage of closed trades that were profitable.';

  const winRate2El = document.getElementById('aResWinRate2');
  winRate2El.textContent = result.numTrades ? `${result.winRate}%` : '—';
  winRate2El.title = 'Win rate shown on the equity curve card.';

  const ddEl = document.getElementById('aResDrawdown');
  ddEl.textContent = result.maxDrawdownPct > 0 ? `-${result.maxDrawdownPct}%` : '—';
  ddEl.title = 'Largest peak‑to‑trough loss during the backtest (risk of big dips).';

  document.getElementById('aResTrades').textContent = result.numTrades;

  const lastPrice = data.close[data.close.length - 1];
  document.getElementById('aResPrice').textContent = `${data.currency} ${lastPrice.toFixed(2)}`;

  const atrLast = ind.atr.filter(v => v != null).pop();
  const slSugg = suggestStopLoss(data.close, ind.atr, riskLvl);
  const posSugg = suggestPositionSize(riskLvl);
  const slEl = document.getElementById('aResStopLoss');
  slEl.textContent = `${slSugg}%  (${(lastPrice * slSugg / 100).toFixed(2)})`;
  slEl.title = 'Suggested stop loss distance based on recent ATR (volatility‑aware).';

  const psEl = document.getElementById('aResPosSize');
  psEl.textContent = `${posSugg}% of balance`;
  psEl.title = 'Suggested position size as a % of account balance for this risk level.';

  const lastVol = ind.vol.filter(v => v != null).pop();
  const volEl = document.getElementById('aResVol');
  volEl.textContent = lastVol ? `${lastVol.toFixed(1)}%` : '—';
  volEl.title = 'Recent historical volatility (higher = larger typical swings).';

  const atrEl = document.getElementById('aResATR');
  atrEl.textContent = atrLast ? `${atrLast.toFixed(2)} (${(atrLast / lastPrice * 100).toFixed(1)}%)` : '—';
  atrEl.title = 'Average True Range: average daily range in price / % terms.';

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

  // Charts (main + 2x2 sub-charts; all linked by time for zoom/pan sync)
  renderAnalysisChart('aChartMain', data, ind, net, { buyDateStr: buyDate });
  renderMACDChart('aChartMACD', data, ind);
  renderRSIChart('aChartRSI', data, ind);
  renderVolatilityChart('aChartVol', data.dates, ind.vol, ind.atr, data.close);
  renderVolumeChart('aChartVolume', data);
  setTimeout(linkAnalysisCharts, 0);

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
  const help = {
    rsiW: 'Relative Strength Index: measures overbought/oversold momentum.',
    trendW: 'EMA trend: direction and strength of the moving-average trend.',
    macdW: 'MACD: momentum and trend‑following crossover strength.',
    bollW: 'Bollinger Bands: price position vs. volatility bands.',
    ichiW: 'Ichimoku Cloud: multi‑factor trend and support/resistance.',
  };
  const container = document.getElementById(containerId);
  if (!container) return;

  const maxAbs = Math.max(...Object.values(weights).map(Math.abs));
  container.innerHTML = Object.entries(weights).map(([k, v]) => {
    const pct = maxAbs > 0 ? Math.abs(v) / maxAbs * 100 : 0;
    const sign = v >= 0 ? '+' : '';
    return `
      <div class="weight-row">
        <div class="weight-name" title="${help[k] || ''}">${labels[k] || k}</div>
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

  try {
    // Unified helper (OHLCV + fundamentals with robust fallbacks)
    const latest = await fetchLatestPriceAndMeta(sym, { days: 90 });

    const buyPrice = latest.price;
    const name = latest.name;
    const sector = latest.sector;
    const dividendYield = latest.dividendYield;

    const portfolio = loadPortfolio();
    const idx = portfolio.findIndex(p => p.symbol === sym);
    const entry = {
      symbol: sym,
      name,
      shares,
      buyPrice,
      buyDate: buyDate || null,
      addedAt: Date.now(),
      currentPrice: buyPrice,
      lastSignal: null,
      lastUpdated: Date.now(),
      sector: sector || null,
      dividendYield: dividendYield ?? 0,
    };

    let toastMsg;
    if (idx >= 0) {
      const ex = portfolio[idx];
      const totalShares = Math.round((ex.shares + shares) * 1e8) / 1e8;
      const avgPrice    = Math.round(((ex.shares * ex.buyPrice + shares * buyPrice) / totalShares) * 100) / 100;
      portfolio[idx] = {
        ...ex,
        shares: totalShares,
        buyPrice: avgPrice,
        currentPrice: buyPrice,
        lastUpdated: Date.now(),
        sector: sector || ex.sector || null,
        dividendYield: (dividendYield ?? ex.dividendYield ?? 0),
      };
      toastMsg = `${sym} averaged — ${totalShares} shares @ avg ${fmtCurrency(avgPrice)}`;
    } else {
      portfolio.push(entry);
      toastMsg = `${sym} added — ${shares} shares @ ${fmtCurrency(buyPrice)}`;
    }
    savePortfolio(portfolio);

    state.portfolio = loadPortfolio();
    symbolInput.value = '';
    sharesInput.value = '';
    if (dateInput) dateInput.value = '';
    _hideDropdown(document.getElementById('pAddSymbolDropdown'));
    renderPortfolioView();
    renderDashboard();
    updatePortfolioBadge();
    showToast(toastMsg);
  } catch (e) {
    showToast(e.message || `Could not fetch price for ${sym}`, 'error');
  }
}

// ══════════════════════════════════════════════════════════════════
// DASHBOARD VIEW
// ══════════════════════════════════════════════════════════════════

function renderDashboard() {
  state.portfolio = loadPortfolio();
  state.watchlist = loadWatchlist();

  const summary = portfolioSummary(state.portfolio);
  const currency = state.settings?.currency || 'EUR';

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

function setSortCol(col) {
  if (state.portfolioSort.col === col) {
    state.portfolioSort.dir = state.portfolioSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    state.portfolioSort.col = col;
    state.portfolioSort.dir = 'asc';
  }
  renderPortfolioView();
}

function sortedPortfolio(portfolio) {
  const { col, dir } = state.portfolioSort;
  if (!col) return portfolio;
  return [...portfolio].sort((a, b) => {
    let va, vb;
    switch (col) {
      case 'symbol':       va = a.symbol; vb = b.symbol; break;
      case 'shares':       va = a.shares; vb = b.shares; break;
      case 'buyPrice':     va = a.buyPrice; vb = b.buyPrice; break;
      case 'currentPrice': va = a.currentPrice || 0; vb = b.currentPrice || 0; break;
      case 'pnlPct': {
        const pa = positionPnL(a), pb = positionPnL(b);
        va = pa.pnlPct ?? -Infinity; vb = pb.pnlPct ?? -Infinity; break;
      }
      case 'dividend': va = a.dividendYield || 0; vb = b.dividendYield || 0; break;
      default: return 0;
    }
    if (typeof va === 'string') return dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
    return dir === 'asc' ? va - vb : vb - va;
  });
}

function _sortArrow(col) {
  const { col: sc, dir } = state.portfolioSort;
  if (sc !== col) return '<span style="opacity:.25;">↕</span>';
  return dir === 'asc' ? '↑' : '↓';
}

function renderPortfolioView() {
  state.portfolio = loadPortfolio();
  const summary  = portfolioSummary(state.portfolio);
  const currency = state.settings?.currency || 'EUR';

  document.getElementById('pTotalValue').textContent = fmtCurrency(summary.totalValue || 0, currency);
  document.getElementById('pTotalPnL').textContent   = (summary.totalPnL >= 0 ? '+' : '') + fmtCurrency(summary.totalPnL, currency);
  document.getElementById('pTotalPnL').className     = 'stat-value ' + (summary.totalPnL >= 0 ? 'pos' : 'neg');
  const pnlPctEl = document.getElementById('pTotalPnLPct');
  if (pnlPctEl) pnlPctEl.textContent = fmtPct(summary.totalPnLPct);
  document.getElementById('pPositionCount').textContent = summary.positions;

  // Last signals update label
  const lastUpdateEl = document.getElementById('pSignalsLastUpdate');
  if (lastUpdateEl) {
    const ts = loadSignalsUpdateTime();
    lastUpdateEl.textContent = ts ? `Signals updated ${timeAgo(ts)}` : 'Signals not yet refreshed';
  }

  // ── Update sortable headers ───────────────────────────────────────
  const thead = document.getElementById('pListHead');
  if (thead) thead.innerHTML = `
    <tr>
      <th onclick="setSortCol('symbol')" style="cursor:pointer;">Symbol ${_sortArrow('symbol')}</th>
      <th>Name</th>
      <th onclick="setSortCol('shares')" style="cursor:pointer;">Shares ${_sortArrow('shares')}</th>
      <th onclick="setSortCol('buyPrice')" style="cursor:pointer;">Buy Price ${_sortArrow('buyPrice')}</th>
      <th onclick="setSortCol('currentPrice')" style="cursor:pointer;">Current ${_sortArrow('currentPrice')}</th>
      <th onclick="setSortCol('pnlPct')" style="cursor:pointer;">P&amp;L ${_sortArrow('pnlPct')}</th>
      <th>Signal</th>
      <th onclick="setSortCol('dividend')" style="cursor:pointer;">Div. Yield ${_sortArrow('dividend')}</th>
      <th>Buy Date</th>
      <th>Actions</th>
    </tr>`;

  const tbody = document.getElementById('pList');
  if (state.portfolio.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="empty-state" style="text-align:center;padding:40px;">
      <div class="empty-icon">💼</div>
      <div class="empty-title">Portfolio is empty</div>
      <div>Enter a ticker and number of shares above, then click Add.</div>
    </td></tr>`;
    // Still render charts with empty/snapshot data
    _renderPortfolioCharts();
    return;
  }

  tbody.innerHTML = sortedPortfolio(state.portfolio).map(p => {
    const { pnl, pnlPct } = positionPnL(p);
    const divYield = p.dividendYield > 0
      ? `<span style="color:${p.dividendYield >= 2 ? 'var(--green)' : 'var(--text2)'};">${p.dividendYield.toFixed(2)}%</span>`
      : '<span class="text-muted">—</span>';
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
        <td>${p.lastSignal ? `<span class="badge ${signalBadgeClass(p.lastSignal)}" title="${explainSignal(p.lastSignal)}">${p.lastSignal}</span>` : '—'}</td>
        <td class="text-xs">${divYield}</td>
        <td class="text-xs text-muted">${p.buyDate ? fmtDate(p.buyDate) : (p.addedAt ? timeAgo(p.addedAt) : '—')}</td>
        <td>
          <div class="flex gap-8">
            <button class="btn btn-ghost btn-xs" onclick="refreshPosition('${p.symbol}')" title="Update price from latest data">↻</button>
            <button class="btn btn-ghost btn-xs" onclick="editPos('${p.symbol}')" title="Edit position (shares / buy price / date)">✎</button>
            <button class="btn btn-ghost btn-xs" onclick="analyseFromWatchlist('${p.symbol}')" title="Re-run analysis for this symbol">Analyse</button>
            <button class="btn btn-danger btn-xs" onclick="removePos('${p.symbol}')" title="Remove position from portfolio">✕ Sell</button>
          </div>
        </td>
      </tr>`;
  }).join('');

  _renderPortfolioCharts();
}

function _renderPortfolioCharts() {
  // Portfolio value history
  renderPortfolioValueChart('pPerfChart', loadSnapshots());

  // Sector breakdown — only if at least one position has sector data
  const withSector = state.portfolio.filter(p => p.sector);
  const sectorCard = document.getElementById('pSectorCard');
  if (sectorCard) {
    if (withSector.length > 0) {
      const sectorMap = {};
      withSector.forEach(p => {
        const s = p.sector;
        sectorMap[s] = (sectorMap[s] || 0) + (p.currentPrice || p.buyPrice) * p.shares;
      });
      renderSectorPie('pSectorChart', Object.keys(sectorMap), Object.values(sectorMap));
      sectorCard.style.display = 'block';
    } else {
      sectorCard.style.display = 'none';
    }
  }
}

async function refreshPosition(symbol) {
  try {
    const latest = await fetchLatestPriceAndMeta(symbol, { days: 90 });
    const price = latest.price;
    const name  = latest.name || symbol;

    updatePositionLiveData(symbol, {
      currentPrice: price,
      name,
    });
    state.portfolio = loadPortfolio();
    renderPortfolioView();
    renderDashboard();
    showToast(`${symbol} → ${fmtCurrency(price)}`);
  } catch (e) {
    showToast(`Failed to refresh ${symbol}: ${e.message}`, 'error');
  }
}

async function refreshAllPositions() {
  const btn = document.getElementById('pRefreshAll');
  if (btn) btn.disabled = true;
  const positions = loadPortfolio();

  // Run refreshes sequentially to avoid race conditions where
  // multiple concurrent saves to localStorage can overwrite each
  // other’s updates.
  for (const p of positions) {
    await refreshPosition(p.symbol);
  }
  // Save daily value snapshot
  const summary = portfolioSummary(loadPortfolio());
  if (summary.totalValue > 0) savePortfolioSnapshot(summary.totalValue);
  if (btn) btn.disabled = false;
  showToast('All positions updated');
}

async function refreshPortfolioSignals() {
  const btn = document.getElementById('pRefreshAll');
  if (btn) { btn.disabled = true; btn.textContent = '↻ Updating signals…'; }

  const positions = loadPortfolio();
  let failed = 0;

  for (const p of positions) {
    let ok = false;
    for (let attempt = 0; attempt < 2 && !ok; attempt++) {
      try {
        if (attempt > 0) await new Promise(r => setTimeout(r, 2000)); // back-off on retry
        const now   = Math.floor(Date.now() / 1000);
        // 90 days → Ichimoku spanB needs 52 bars, EMA(200) needs warm-up; 30 days was too short
        const start = now - 90 * 24 * 3600;
        const data  = await fetchYahooOHLCV(p.symbol, start, now, '1d');
        const ind   = buildIndicators(data);
        const { bestSignal } = await optimise(data.close, ind, { nTrials: 100 });
        const lastRSI = ind.rsi.filter(v => v != null).pop();
        const signal  = currentSignal(bestSignal, lastRSI, 0.5);
        updatePositionLiveData(p.symbol, {
          currentPrice: data.close[data.close.length - 1],
          lastSignal:   signal,
          name:         data.name || p.name,
        });
        ok = true;
      } catch (e) {
        console.warn(`[Morfeo] Signal refresh failed for ${p.symbol} (attempt ${attempt + 1}):`, e.message);
      }
    }
    if (!ok) failed++;
    await new Promise(r => setTimeout(r, 500));
  }

  saveSignalsUpdateTime();
  state.portfolio = loadPortfolio();
  renderPortfolioView();
  renderDashboard();
  if (btn) { btn.disabled = false; btn.textContent = '↻ Refresh All'; }
  showToast(failed > 0
    ? `Signals updated — ${failed} symbol${failed > 1 ? 's' : ''} failed (see console)`
    : 'Portfolio signals updated',
    failed > 0 ? 'error' : 'ok'
  );
}

function startAutoSignalRefresh() {
  const TWELVE_HOURS = 12 * 60 * 60 * 1000;

  function checkAndRefresh() {
    const lastUpdate = loadSignalsUpdateTime();
    if (loadPortfolio().length > 0 && (!lastUpdate || (Date.now() - lastUpdate) >= TWELVE_HOURS)) {
      refreshPortfolioSignals();
    }
  }

  // Check shortly after startup
  setTimeout(checkAndRefresh, 4000);
  // Re-check every 30 minutes so the 12 h mark is never missed by more than 30 min
  setInterval(checkAndRefresh, 30 * 60 * 1000);
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

function editPos(symbol) {
  const portfolio = loadPortfolio();
  const idx = portfolio.findIndex(p => p.symbol === symbol.toUpperCase());
  if (idx < 0) return;
  const pos = portfolio[idx];

  const newSharesStr = prompt(`Update shares for ${symbol}:`, pos.shares);
  if (newSharesStr === null) return;
  const newShares = parseFloat(newSharesStr);
  if (!newShares || newShares <= 0) {
    showToast('Invalid shares value', 'error');
    return;
  }

  const newPriceStr = prompt(`Update buy price for ${symbol}:`, pos.buyPrice);
  if (newPriceStr === null) return;
  const newPrice = parseFloat(newPriceStr);
  if (!newPrice || newPrice <= 0) {
    showToast('Invalid buy price', 'error');
    return;
  }

  const newDateStr = prompt(
    `Update buy date for ${symbol} (YYYY-MM-DD, leave empty to clear):`,
    pos.buyDate || ''
  );
  const buyDate = newDateStr && newDateStr.trim() ? newDateStr.trim() : null;

  portfolio[idx] = {
    ...pos,
    shares: newShares,
    buyPrice: newPrice,
    buyDate,
    lastUpdated: Date.now(),
  };
  savePortfolio(portfolio);
  state.portfolio = loadPortfolio();
  renderPortfolioView();
  renderDashboard();
  updatePortfolioBadge();
  showToast(`${symbol} position updated`);
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
      <td>${w.lastSignal ? `<span class="badge ${signalBadgeClass(w.lastSignal)}" title="${explainSignal(w.lastSignal)}">${w.lastSignal}</span>` : '—'}</td>
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
  let failed = 0;

  for (const w of state.watchlist) {
    let ok = false;
    for (let attempt = 0; attempt < 2 && !ok; attempt++) {
      try {
        if (attempt > 0) await new Promise(r => setTimeout(r, 2000));
        const now = Math.floor(Date.now() / 1000);
        const start = now - 90 * 24 * 3600; // 90 days for reliable indicators
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
        ok = true;
      } catch (e) {
        console.warn(`[Morfeo] Watchlist refresh failed for ${w.symbol} (attempt ${attempt + 1}):`, e.message);
      }
    }
    if (!ok) failed++;
    await new Promise(r => setTimeout(r, 500));
  }

  state.watchlist = loadWatchlist();
  renderWatchlistView();
  if (btn) btn.disabled = false;
  showToast(failed > 0
    ? `Watchlist refreshed — ${failed} symbol${failed > 1 ? 's' : ''} failed (see console)`
    : 'Watchlist refreshed',
    failed > 0 ? 'error' : 'ok'
  );
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
  localStorage.removeItem(SNAPSHOTS_KEY);
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

// ── CSV import ────────────────────────────────────────────────────
// Expected columns: Symbol, Shares, Buy Price (optional), Buy Date (optional)

async function importPortfolioCSV(event) {
  const file = event.target.files[0];
  if (!file) return;
  event.target.value = '';
  const text = await file.text();
  const lines = text.trim().split('\n').filter(l => l.trim());
  if (lines.length < 2) { showToast('CSV has no data rows', 'error'); return; }

  // Detect header row (first cell non-numeric)
  const startIdx = isNaN(parseFloat(lines[0].split(',')[0])) ? 1 : 0;
  const dataLines = lines.slice(startIdx);

  showToast(`Importing ${dataLines.length} rows…`);
  let added = 0, failed = 0;

  for (const line of dataLines) {
    const cols = line.split(',').map(s => s.trim().replace(/^"|"$/g, ''));
    const sym    = cols[0]?.toUpperCase();
    const shares = parseFloat(cols[1]);
    if (!sym || !shares || shares <= 0) { failed++; continue; }

    const buyPriceCSV = cols[2] ? parseFloat(cols[2]) : null;
    const buyDateCSV  = cols[3] ? cols[3].trim() : null;

    let buyPrice = buyPriceCSV;
    let name = sym, sector = null, dividendYield = 0;

    if (!buyPrice) {
      try {
        const r = await fetch(`/api/quote?symbol=${encodeURIComponent(sym)}`);
        if (r.ok) {
          const json = await r.json();
          const q = json?.quoteResponse?.result?.[0];
          if (q) {
            buyPrice = q.regularMarketPrice || q.regularMarketPreviousClose || q.ask || null;
            name = q.longName || q.shortName || sym;
            sector = q.sector || null;
            dividendYield = q.dividendYield ? q.dividendYield * 100 : 0;
          }
        }
      } catch (e) {}
    }

    if (!buyPrice) { failed++; continue; }

    const portfolio = loadPortfolio();
    const idx = portfolio.findIndex(p => p.symbol === sym);
    const entry = {
      symbol: sym, name, shares, buyPrice, buyDate: buyDateCSV || null,
      addedAt: Date.now(), currentPrice: buyPrice, lastSignal: null,
      lastUpdated: Date.now(), sector, dividendYield,
    };
    if (idx >= 0) {
      const ex = portfolio[idx];
      const totalShares = Math.round((ex.shares + shares) * 1e8) / 1e8;
      const avgPrice    = Math.round(((ex.shares * ex.buyPrice + shares * buyPrice) / totalShares) * 100) / 100;
      portfolio[idx] = { ...ex, shares: totalShares, buyPrice: avgPrice, currentPrice: buyPrice, lastUpdated: Date.now() };
    } else {
      portfolio.push(entry);
    }
    savePortfolio(portfolio);
    added++;
    await new Promise(r => setTimeout(r, 150)); // small delay to avoid rate-limiting
  }

  state.portfolio = loadPortfolio();
  renderPortfolioView();
  renderDashboard();
  updatePortfolioBadge();
  showToast(`CSV imported — ${added} added, ${failed} skipped${failed ? ' (check console)' : ''}`);
}

// ── Correlation matrix ────────────────────────────────────────────

function pearsonCorrelation(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 5) return 0;
  const ax = a.slice(-n), bx = b.slice(-n);
  const ma = ax.reduce((s, v) => s + v, 0) / n;
  const mb = bx.reduce((s, v) => s + v, 0) / n;
  const num = ax.reduce((s, v, i) => s + (v - ma) * (bx[i] - mb), 0);
  const da  = Math.sqrt(ax.reduce((s, v) => s + (v - ma) ** 2, 0));
  const db  = Math.sqrt(bx.reduce((s, v) => s + (v - mb) ** 2, 0));
  return da && db ? Math.round(num / (da * db) * 100) / 100 : 0;
}

function dailyReturns(closes) {
  const r = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] != null && closes[i - 1] != null && closes[i - 1] !== 0)
      r.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  }
  return r;
}

async function buildCorrelationMatrix() {
  const positions = loadPortfolio();
  if (positions.length < 2) { showToast('Need at least 2 positions for correlation', 'error'); return; }

  const btn = document.getElementById('pCorrBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Computing…'; }

  const now   = Math.floor(Date.now() / 1000);
  const start = now - 90 * 24 * 3600;

  const results = await Promise.allSettled(
    positions.map(p => fetchYahooOHLCV(p.symbol, start, now, '1d'))
  );

  const valid = results
    .map((r, i) => r.status === 'fulfilled' ? { symbol: positions[i].symbol, closes: r.value.close } : null)
    .filter(Boolean);

  if (valid.length < 2) {
    showToast('Could not fetch data for correlation matrix', 'error');
    if (btn) { btn.disabled = false; btn.textContent = '↻ Compute'; }
    return;
  }

  const symbols = valid.map(v => v.symbol);
  const returns = valid.map(v => dailyReturns(v.closes));
  const n = symbols.length;
  const matrix = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => i === j ? 1 : pearsonCorrelation(returns[i], returns[j]))
  );

  renderCorrelationHeatmap('pCorrMatrix', symbols, matrix);
  if (btn) { btn.disabled = false; btn.textContent = '↻ Compute'; }
}

// ── Multi-timeframe signal consensus ──────────────────────────────

async function runConsensusAnalysis(data) {
  const tfList = ['scalp', 'swing', 'longterm'];
  return Promise.all(tfList.map(async tf => {
    try {
      const config = timeframeConfig(tf);
      const ind    = buildIndicators(data, config);
      const { bestSignal } = await optimise(data.close, ind, { nTrials: 120, riskLevel: 0.5 });
      const lastRSI = ind.rsi.filter(v => v != null).pop();
      return { tf, signal: currentSignal(bestSignal, lastRSI, 0.5) };
    } catch { return { tf, signal: 'HOLD' }; }
  }));
}

function renderConsensusResults(results) {
  const card = document.getElementById('aConsensusCard');
  const el   = document.getElementById('aConsensus');
  if (!card || !el) return;

  const buys  = results.filter(r => r.signal === 'BUY'  || r.signal === 'WATCH-BUY').length;
  const sells = results.filter(r => r.signal === 'SELL' || r.signal === 'WATCH-SELL').length;

  let consensus, cls;
  if      (buys  === 3) { consensus = 'STRONG BUY';  cls = 'badge-buy';  }
  else if (buys  === 2) { consensus = 'BUY';          cls = 'badge-buy';  }
  else if (sells === 3) { consensus = 'STRONG SELL';  cls = 'badge-sell'; }
  else if (sells === 2) { consensus = 'SELL';          cls = 'badge-sell'; }
  else                  { consensus = 'MIXED / HOLD';  cls = 'badge-hold'; }

  const tfLabel = { scalp: 'Scalp', swing: 'Swing', longterm: 'Long-term' };
  el.innerHTML = `
    <div style="display:flex; gap:20px; align-items:center; flex-wrap:wrap;">
      ${results.map(r => `
        <div style="text-align:center;">
          <div style="font-size:9px; letter-spacing:0.12em; text-transform:uppercase; color:var(--muted); margin-bottom:5px;">${tfLabel[r.tf]}</div>
          <span class="badge ${signalBadgeClass(r.signal)}">${r.signal}</span>
        </div>`).join('')}
      <div style="margin-left:auto; text-align:right;">
        <div style="font-size:9px; letter-spacing:0.12em; text-transform:uppercase; color:var(--muted); margin-bottom:5px;">Overall Consensus</div>
        <span class="badge ${cls}" style="font-size:13px; padding:5px 14px;">${consensus}</span>
      </div>
    </div>
    <div style="font-size:10px; color:var(--muted); margin-top:10px;">
      All three timeframes run on the same OHLCV data with timeframe-tuned indicator parameters (120 optimisation trials each).
    </div>`;
  card.style.display = 'block';
}

// ── Backup export / import ────────────────────────────────────────

function exportData() {
  const backup = {
    version: 1,
    exportedAt: new Date().toISOString(),
    portfolio: localStorage.getItem(STORAGE_KEY),
    watchlist: localStorage.getItem(WATCHLIST_KEY),
    settings:  localStorage.getItem(SETTINGS_KEY),
    snapshots: localStorage.getItem(SNAPSHOTS_KEY),
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
      if (backup.snapshots) localStorage.setItem(SNAPSHOTS_KEY, backup.snapshots);
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
