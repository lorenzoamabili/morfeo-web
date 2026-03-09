// ═══════════════════════════════════════════════════════════════
// MORFEO v3 — charts.js
// All Plotly chart rendering functions
// ═══════════════════════════════════════════════════════════════

const CHART_THEME = {
  paper: '#0f1118',
  plot: '#0b0d12',
  grid: '#1c1f2e',
  line: '#252836',
  text: '#9da3c0',
  text2: '#5a5e78',
  gold: '#c9a84c',
  green: '#3dba7e',
  red: '#e04f5f',
  blue: '#4f7ef8',
  orange: '#e07a3a',
  muted: '#525878',
};

const BASE_LAYOUT = {
  paper_bgcolor: CHART_THEME.paper,
  plot_bgcolor: CHART_THEME.plot,
  font: { family: "'IBM Plex Mono', monospace", color: CHART_THEME.text, size: 11 },
  xaxis: {
    gridcolor: CHART_THEME.grid,
    linecolor: CHART_THEME.line,
    tickfont: { color: CHART_THEME.text2, size: 10 },
    showspikes: true,
    spikecolor: '#32364a',
    spikethickness: 1,
    spikemode: 'across',
  },
  yaxis: {
    gridcolor: CHART_THEME.grid,
    linecolor: CHART_THEME.line,
    tickfont: { color: CHART_THEME.text2, size: 10 },
    showspikes: true,
    spikecolor: '#32364a',
    spikethickness: 1,
  },
  legend: {
    bgcolor: 'rgba(15,17,24,0.9)',
    bordercolor: '#252836',
    borderwidth: 1,
    font: { color: CHART_THEME.text, size: 10 },
  },
  margin: { l: 60, r: 20, t: 20, b: 52 },
  hovermode: 'x unified',
  hoverlabel: {
    bgcolor: '#14172a',
    bordercolor: '#252836',
    font: { color: CHART_THEME.text, size: 11 }
  },
  autosize: true,
};

const PLOTLY_CONFIG = {
  responsive: true,
  displayModeBar: true,
  modeBarButtonsToRemove: ['lasso2d', 'select2d', 'autoScale2d'],
  displaylogo: false,
};

// ── Main analysis chart (price + EMAs + signals + Bollinger) ─────

function renderAnalysisChart(containerId, data, ind, net, options = {}) {
  const { buyDateStr = null, showBollinger = true, showIchi = false } = options;
  const { dates, close } = data;
  const n = 0; // signal threshold

  const maxSig = Math.max(...net.map(Math.abs), 1);
  const normSig = net.map(v => Math.abs(v) / maxSig);

  const buyIdx = net.map((v, i) => v > n ? i : -1).filter(i => i >= 0);
  const sellIdx = net.map((v, i) => v < -n ? i : -1).filter(i => i >= 0);

  const traces = [
    // Bollinger bands
    ...(showBollinger && ind.bUpper ? [
      {
        x: dates, y: ind.bUpper,
        type: 'scatter', mode: 'lines',
        name: 'BB Upper',
        line: { color: 'rgba(79,126,248,0.25)', width: 1, dash: 'dot' },
        showlegend: false,
        hoverinfo: 'skip',
      },
      {
        x: dates, y: ind.bLower,
        type: 'scatter', mode: 'lines',
        name: 'BB Lower',
        fill: 'tonexty',
        fillcolor: 'rgba(79,126,248,0.04)',
        line: { color: 'rgba(79,126,248,0.25)', width: 1, dash: 'dot' },
        showlegend: false,
        hoverinfo: 'skip',
      },
    ] : []),

    // Price
    {
      x: dates, y: close,
      type: 'scatter', mode: 'lines',
      name: 'Close',
      line: { color: CHART_THEME.blue, width: 2 },
    },

    // EMAs
    {
      x: dates, y: ind.ema200,
      type: 'scatter', mode: 'lines',
      name: 'EMA 200',
      line: { color: CHART_THEME.red, width: 1, dash: 'dot' },
    },
    {
      x: dates, y: ind.ema25,
      type: 'scatter', mode: 'lines',
      name: 'EMA 25',
      line: { color: CHART_THEME.gold, width: 1.2 },
    },

    // Buy markers
    {
      x: buyIdx.map(i => dates[i]),
      y: buyIdx.map(i => close[i]),
      type: 'scatter', mode: 'markers',
      name: '▲ Buy',
      marker: {
        symbol: 'triangle-up', size: 11,
        color: buyIdx.map(i => normSig[i]),
        colorscale: [[0, '#a8f0cb'], [0.5, CHART_THEME.green], [1, '#1a6b4a']],
        line: { width: 0 },
      },
    },

    // Sell markers
    {
      x: sellIdx.map(i => dates[i]),
      y: sellIdx.map(i => close[i]),
      type: 'scatter', mode: 'markers',
      name: '▼ Sell',
      marker: {
        symbol: 'triangle-down', size: 11,
        color: sellIdx.map(i => normSig[i]),
        colorscale: [[0, '#f5b0b8'], [0.5, CHART_THEME.red], [1, '#7a1020']],
        line: { width: 0 },
      },
    },
  ];

  const shapes = [];
  if (buyDateStr) {
    shapes.push({
      type: 'line', x0: buyDateStr, x1: buyDateStr,
      y0: 0, y1: 1, yref: 'paper',
      line: { color: CHART_THEME.gold, width: 1.5, dash: 'dot' },
    });
  }

  const layout = {
    ...BASE_LAYOUT,
    shapes,
    height: 420,
    title: { text: '', font: { size: 0 } },
  };

  Plotly.newPlot(containerId, traces, layout, PLOTLY_CONFIG);
}

// ── MACD sub-chart ───────────────────────────────────────────────

function renderMACDChart(containerId, data, ind) {
  const { dates } = data;
  const histColors = ind.macdHist.map(v => v > 0 ? CHART_THEME.green : CHART_THEME.red);

  const traces = [
    {
      x: dates, y: ind.macd,
      type: 'scatter', mode: 'lines',
      name: 'MACD', line: { color: CHART_THEME.blue, width: 1.5 },
    },
    {
      x: dates, y: ind.macdSig,
      type: 'scatter', mode: 'lines',
      name: 'Signal', line: { color: CHART_THEME.orange, width: 1.5 },
    },
    {
      x: dates, y: ind.macdHist,
      type: 'bar', name: 'Histogram',
      marker: { color: histColors, opacity: 0.7 },
    },
  ];

  Plotly.newPlot(containerId, traces, {
    ...BASE_LAYOUT,
    height: 160,
    margin: { ...BASE_LAYOUT.margin, t: 10, b: 40 },
    showlegend: false,
    yaxis: { ...BASE_LAYOUT.yaxis, zeroline: true, zerolinecolor: '#252836', zerolinewidth: 1 },
  }, PLOTLY_CONFIG);
}

// ── RSI sub-chart ────────────────────────────────────────────────

function renderRSIChart(containerId, data, ind) {
  const { dates } = data;

  const traces = [
    {
      x: dates, y: ind.rsi,
      type: 'scatter', mode: 'lines',
      name: 'RSI', line: { color: CHART_THEME.gold, width: 1.5 },
      fill: 'tozeroy',
      fillcolor: 'rgba(201,168,76,0.05)',
    },
  ];

  Plotly.newPlot(containerId, traces, {
    ...BASE_LAYOUT,
    height: 140,
    margin: { ...BASE_LAYOUT.margin, t: 10, b: 40 },
    showlegend: false,
    yaxis: {
      ...BASE_LAYOUT.yaxis,
      range: [0, 100],
      tickvals: [30, 70],
    },
    shapes: [
      {
        type: 'line', x0: dates[0], x1: dates[dates.length - 1], y0: 70, y1: 70,
        line: { color: 'rgba(224,79,95,0.4)', width: 1, dash: 'dot' }
      },
      {
        type: 'line', x0: dates[0], x1: dates[dates.length - 1], y0: 30, y1: 30,
        line: { color: 'rgba(61,186,126,0.4)', width: 1, dash: 'dot' }
      },
    ],
  }, PLOTLY_CONFIG);
}

// ── Portfolio equity curve ────────────────────────────────────────

function renderEquityCurve(containerId, dates, close, net, benchmarkClose, options = {}) {
  const { initialBalance = 10000, riskLevel = 0.5 } = options;

  // Build equity curve
  let balance = Math.max(initialBalance, close[0]);
  let position = 0;
  let buyPrice = 0;
  let lastAction = null;
  const threshold = (1 - riskLevel) * 0.3;

  const equityValues = close.map((price, i) => {
    const sig = net[i];
    if (sig > threshold && position === 0 && lastAction !== 'buy') {
      position = Math.floor(balance / price);
      buyPrice = price;
      balance -= position * price + 3;
      lastAction = 'buy';
    } else if (sig < -threshold && position > 0 && lastAction !== 'sell') {
      balance += position * price - 3;
      position = 0;
      lastAction = 'sell';
    }
    return balance + position * price;
  });

  // Benchmark (buy & hold)
  const bShares = Math.floor(initialBalance / benchmarkClose[0]);
  const benchmark = benchmarkClose.map(p => bShares * p);

  const traces = [
    {
      x: dates, y: equityValues,
      type: 'scatter', mode: 'lines',
      name: 'Morfeo Strategy',
      line: { color: CHART_THEME.gold, width: 2 },
      fill: 'tozeroy', fillcolor: 'rgba(201,168,76,0.05)',
    },
    {
      x: dates, y: benchmark,
      type: 'scatter', mode: 'lines',
      name: 'Buy & Hold',
      line: { color: CHART_THEME.muted, width: 1.5, dash: 'dot' },
    },
  ];

  Plotly.newPlot(containerId, traces, {
    ...BASE_LAYOUT,
    height: 260,
    margin: { ...BASE_LAYOUT.margin, t: 10 },
  }, PLOTLY_CONFIG);
}

// ── Correlation heatmap ───────────────────────────────────────────

function renderCorrelationHeatmap(containerId, symbols, matrix) {
  const n = symbols.length;
  const z = matrix;

  const colorscale = [
    [0, '#e04f5f'],
    [0.5, '#1c1f2e'],
    [1, '#3dba7e'],
  ];

  const traces = [{
    type: 'heatmap',
    z,
    x: symbols,
    y: symbols,
    colorscale,
    zmin: -1, zmax: 1,
    text: z.map(row => row.map(v => v.toFixed(2))),
    texttemplate: '%{text}',
    textfont: { size: 11, color: '#e2e5f4' },
    hovertemplate: '%{y} / %{x}: %{z:.2f}<extra></extra>',
    showscale: true,
    colorbar: {
      thickness: 12,
      tickfont: { color: CHART_THEME.text2, size: 10 },
      tickvals: [-1, -0.5, 0, 0.5, 1],
    },
  }];

  Plotly.newPlot(containerId, traces, {
    ...BASE_LAYOUT,
    height: Math.max(240, n * 52 + 80),
    margin: { l: 70, r: 60, t: 20, b: 70 },
    xaxis: { ...BASE_LAYOUT.xaxis, tickangle: -30 },
    showlegend: false,
  }, PLOTLY_CONFIG);
}

// ── Portfolio value history chart ─────────────────────────────────

function renderPortfolioValueChart(containerId, snapshots) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!snapshots || snapshots.length < 2) {
    el.innerHTML = '<div style="text-align:center;padding:32px 20px;color:var(--muted);font-size:11px;">No history yet — refresh positions to start recording daily values.</div>';
    return;
  }
  const dates  = snapshots.map(s => s.date);
  const values = snapshots.map(s => s.value);
  const first  = values[0], last = values[values.length - 1];
  const color     = last >= first ? CHART_THEME.green : CHART_THEME.red;
  const fillColor = last >= first ? 'rgba(61,186,126,0.06)' : 'rgba(224,79,95,0.06)';

  Plotly.newPlot(containerId, [{
    x: dates, y: values,
    type: 'scatter', mode: 'lines',
    name: 'Portfolio Value',
    line: { color, width: 2 },
    fill: 'tozeroy', fillcolor: fillColor,
    hovertemplate: '%{x}: $%{y:,.0f}<extra></extra>',
  }], {
    ...BASE_LAYOUT,
    height: 200,
    margin: { ...BASE_LAYOUT.margin, t: 10 },
    yaxis: { ...BASE_LAYOUT.yaxis, tickprefix: '$', tickformat: ',.0f' },
    showlegend: false,
  }, PLOTLY_CONFIG);
}

// ── Sector breakdown pie chart ────────────────────────────────────

function renderSectorPie(containerId, labels, values) {
  const SECTOR_COLORS = [
    CHART_THEME.gold, CHART_THEME.blue, CHART_THEME.green, CHART_THEME.orange,
    CHART_THEME.red, '#a855f7', '#06b6d4', '#f59e0b', '#84cc16', '#ec4899',
  ];
  Plotly.newPlot(containerId, [{
    type: 'pie', labels, values,
    hole: 0.42,
    textinfo: 'label+percent',
    textfont: { color: CHART_THEME.text, size: 11 },
    marker: { colors: SECTOR_COLORS, line: { color: CHART_THEME.paper, width: 2 } },
    hovertemplate: '%{label}: %{value:.1f} (%{percent})<extra></extra>',
  }], {
    ...BASE_LAYOUT,
    height: 220,
    margin: { l: 20, r: 20, t: 20, b: 20 },
    showlegend: false,
  }, PLOTLY_CONFIG);
}

// ── Volatility / ATR chart ────────────────────────────────────────

function renderVolatilityChart(containerId, dates, vol, atr, close) {
  const atrPct = atr.map((v, i) => v != null && close[i] ? (v / close[i]) * 100 : null);

  const traces = [
    {
      x: dates, y: vol,
      type: 'scatter', mode: 'lines',
      name: 'Annualised Vol %',
      line: { color: CHART_THEME.orange, width: 1.5 },
      yaxis: 'y',
    },
    {
      x: dates, y: atrPct,
      type: 'scatter', mode: 'lines',
      name: 'ATR %',
      line: { color: CHART_THEME.blue, width: 1.5, dash: 'dash' },
      yaxis: 'y',
    },
  ];

  Plotly.newPlot(containerId, traces, {
    ...BASE_LAYOUT,
    height: 200,
    margin: { ...BASE_LAYOUT.margin, t: 10 },
    yaxis: { ...BASE_LAYOUT.yaxis, ticksuffix: '%' },
  }, PLOTLY_CONFIG);
}
