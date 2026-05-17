// ═══════════════════════════════════════════════════════════════
// MORFEO v3 — optimiser.js
// Signal construction, genetic optimiser, backtester
// ═══════════════════════════════════════════════════════════════

// ── Normalise weight object ──────────────────────────────────────
function normaliseWeights(w) {
  const total = Object.values(w).reduce((s, v) => s + Math.abs(v), 0);
  if (total === 0) return w;
  const out = {};
  for (const k in w) out[k] = w[k] / total;
  return out;
}

// ── Build net signal from indicators + weights ───────────────────
function buildNetSignal(ind, weights) {
  const { rsiW, trendW, macdW, bollW, ichiW, obvW = 0 } = weights;
  const n = ind.rsiBuy.length;

  const raw = new Array(n);
  for (let i = 0; i < n; i++) {
    const tBuy  = trendW * (ind.e200Buy[i]  + ind.e100Buy[i]  + ind.e50Buy[i]  + ind.e25Buy[i]);
    const tSell = trendW * (ind.e200Sell[i] + ind.e100Sell[i] + ind.e50Sell[i] + ind.e25Sell[i]);
    const buy  = rsiW * ind.rsiBuy[i]  + tBuy  + macdW * ind.macdBuy[i]  + bollW * ind.bollBuy[i]  + ichiW * ind.ichiBuy[i]  + obvW * (ind.obvBuy?.[i]  ?? 0);
    const sell = rsiW * ind.rsiSell[i] + tSell + macdW * ind.macdSell[i] + bollW * ind.bollSell[i] + ichiW * ind.ichiSell[i] + obvW * (ind.obvSell?.[i] ?? 0);
    raw[i] = buy - sell;
  }
  return transformSignal(raw);
}

// Removes consecutive same-direction signals (keep only transitions)
function transformSignal(arr) {
  return arr.map((v, i) => {
    if (i === 0) return 0;
    const prev = arr[i - 1];
    return (v * prev <= 0 && prev !== 0) ? v : 0;
  });
}

// ── Backtester ───────────────────────────────────────────────────
// riskLevel: 0 (conservative) → 1 (aggressive)
//   conservative = requires stronger signal threshold
//   aggressive   = acts on weaker signals

function backtest(close, signal, options = {}) {
  const {
    initialBalance = 300,
    riskLevel = 0.5,   // 0–1
    stopLossPct = null,   // e.g. 0.05 = 5% stop loss
    takeProfitPct = null,
    positionSizePct = null,   // fraction of balance per trade (null = all-in)
  } = options;

  // Signal threshold: aggressive acts on anything > 0, conservative needs stronger signal
  const threshold = (1 - riskLevel) * 0.3; // 0 to 0.3 range

  let balance = Math.max(initialBalance, close[0]);
  let position = 0;
  let buyPrice = 0;
  let lastAction = null;
  let trades = [];
  let tradeOpen = null;

  const maxBal = balance;
  let peakBal = balance;
  let maxDrawdown = 0;

  for (let i = 0; i < close.length; i++) {
    const price = close[i];
    const sig = signal[i];

    // Check stop loss / take profit on open position
    if (position > 0) {
      const chg = (price - buyPrice) / buyPrice;
      if (stopLossPct != null && chg <= -stopLossPct) {
        balance += position * price - 3;
        trades.push({ type: 'sell', reason: 'stop-loss', entry: buyPrice, exit: price, gain: chg * 100, i });
        position = 0; lastAction = 'sell'; tradeOpen = null;
      } else if (takeProfitPct != null && chg >= takeProfitPct) {
        balance += position * price - 3;
        trades.push({ type: 'sell', reason: 'take-profit', entry: buyPrice, exit: price, gain: chg * 100, i });
        position = 0; lastAction = 'sell'; tradeOpen = null;
      }
    }

    // Buy signal
    if (sig > threshold && position === 0 && lastAction !== 'buy') {
      const allocPct = positionSizePct ? positionSizePct : 1.0;
      const allocated = balance * allocPct;
      position = Math.floor(allocated / price);
      if (position < 1) continue;
      buyPrice = price;
      balance -= position * price + 3;
      lastAction = 'buy';
      tradeOpen = { entry: price, i };
    }
    // Sell signal
    else if (sig < -threshold && position > 0 && lastAction !== 'sell') {
      const gain = ((price - buyPrice) / buyPrice) * 100;
      balance += position * price - 3;
      trades.push({ type: 'sell', reason: 'signal', entry: buyPrice, exit: price, gain, i });
      position = 0;
      lastAction = 'sell';
      tradeOpen = null;
    }

    // Drawdown tracking
    const currentVal = balance + position * price;
    if (currentVal > peakBal) peakBal = currentVal;
    const dd = (peakBal - currentVal) / peakBal;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  const finalPrice = close[close.length - 1];
  const finalVal = balance + position * finalPrice;
  const profitPct = Math.round(((finalVal - initialBalance) / initialBalance) * 10000) / 100;
  const winRate = trades.length ? trades.filter(t => t.gain > 0).length / trades.length : 0;
  const avgGain = trades.length ? trades.reduce((s, t) => s + t.gain, 0) / trades.length : 0;

  return {
    profitPct,
    finalVal,
    trades,
    numTrades: trades.length,
    winRate: Math.round(winRate * 100),
    avgGainPct: Math.round(avgGain * 100) / 100,
    maxDrawdownPct: Math.round(maxDrawdown * 10000) / 100,
    openPosition: position > 0 ? { shares: position, buyPrice, currentPrice: finalPrice } : null,
  };
}

// ── Buy-and-hold benchmark ───────────────────────────────────────
function buyAndHold(close, initialBalance = 300) {
  const startPrice = close[0];
  const endPrice = close[close.length - 1];
  const shares = Math.floor(Math.max(initialBalance, startPrice) / startPrice);
  const startVal = shares * startPrice;
  const endVal = shares * endPrice;
  return Math.round(((endVal - startVal) / startVal) * 10000) / 100;
}

// ── Optimiser: random search + hill-climbing, with train/test split ─
// Phase 1: 400-trial random search on the training slice (first 70% of data).
// Phase 2: coordinate-descent hill-climbing to refine the best candidate.
// Evaluation: final signal is built on full data; out-of-sample return is
// measured on the held-out 30% that was never seen during optimisation.

async function optimise(close, ind, options = {}) {
  const {
    nTrials = 400,
    buyDayIdx = -1,
    riskLevel = 0.5,
    onProgress = null,
    backtestOpts = {},
  } = options;

  const splitIdx = Math.max(20, Math.floor(close.length * 0.7));
  const trainClose = close.slice(0, splitIdx);

  let bestTrainProfit = -Infinity;
  let bestWeights = null;

  const CHUNK = 50;
  const TOTAL_PHASE1 = nTrials;

  // ── Phase 1: random search on training slice ──────────────────
  for (let start = 0; start < TOTAL_PHASE1; start += CHUNK) {
    await new Promise(r => setTimeout(r, 0)); // yield to UI

    for (let t = start; t < Math.min(start + CHUNK, TOTAL_PHASE1); t++) {
      const raw = {
        rsiW:   Math.random() * 2 - 1,
        trendW: Math.random() * 2 - 1,
        macdW:  Math.random() * 2 - 1,
        bollW:  Math.random() * 2 - 1,
        ichiW:  Math.random() * 2 - 1,
        obvW:   Math.random() * 2 - 1,
      };
      const w = normaliseWeights(raw);
      const trainNet = buildNetSignal(ind, w).slice(0, splitIdx);
      const result = backtest(trainClose, trainNet, { riskLevel, ...backtestOpts });
      if (result.profitPct > bestTrainProfit) {
        bestTrainProfit = result.profitPct;
        bestWeights = w;
      }
    }

    if (onProgress) onProgress(Math.min((start + CHUNK) / TOTAL_PHASE1, 1) * 0.80);
  }

  // ── Phase 2: coordinate-descent hill-climbing on training slice ─
  const HILL_STEP = 0.15;
  const HILL_MAX_ITERS = 30;
  for (let iter = 0; iter < HILL_MAX_ITERS; iter++) {
    await new Promise(r => setTimeout(r, 0));
    let improved = false;
    for (const key of Object.keys(bestWeights)) {
      for (const delta of [HILL_STEP, -HILL_STEP]) {
        const cw = normaliseWeights({ ...bestWeights, [key]: bestWeights[key] + delta });
        const trainNet = buildNetSignal(ind, cw).slice(0, splitIdx);
        const r = backtest(trainClose, trainNet, { riskLevel, ...backtestOpts });
        if (r.profitPct > bestTrainProfit) {
          bestTrainProfit = r.profitPct;
          bestWeights = cw;
          improved = true;
        }
      }
    }
    if (!improved) break;
    if (onProgress) onProgress(0.80 + (iter / HILL_MAX_ITERS) * 0.15);
  }

  // ── Build full signal for charting ──────────────────────────────
  let bestSignal = buildNetSignal(ind, bestWeights);
  if (buyDayIdx >= 0) {
    const maxV = Math.max(...bestSignal);
    bestSignal = [...bestSignal];
    bestSignal[buyDayIdx] = maxV;
  }

  // ── Out-of-sample evaluation on held-out 30% ───────────────────
  const testClose  = close.slice(splitIdx);
  const testSignal = bestSignal.slice(splitIdx);
  const testResult = backtest(testClose, testSignal, { riskLevel, ...backtestOpts });

  if (onProgress) onProgress(1);
  return { bestWeights, bestSignal, bestProfit: bestTrainProfit, testProfit: testResult.profitPct, splitIdx };
}

// ── Risk profile helpers ─────────────────────────────────────────

// riskLevel 0-100 → 0-1, returns human label + colour
function riskProfile(level) {
  if (level <= 20) return { label: 'Conservative', color: 'var(--green)', desc: 'Requires strong indicator consensus. Lower signal frequency, tighter thresholds.' };
  if (level <= 40) return { label: 'Moderate', color: '#7ec87e', desc: 'Balanced signal sensitivity. Suitable for regular swing trading.' };
  if (level <= 60) return { label: 'Balanced', color: 'var(--gold)', desc: 'Standard sensitivity. Mirrors default optimised settings.' };
  if (level <= 80) return { label: 'Aggressive', color: 'var(--orange)', desc: 'Lower signal threshold. More frequent trades, higher variance.' };
  return { label: 'Speculative', color: 'var(--red)', desc: 'Acts on minimal signal. Maximum trade frequency, maximum risk.' };
}

// Suggest stop-loss % based on ATR and risk level
function suggestStopLoss(close, atr, riskLevel) {
  const lastPrice = close[close.length - 1];
  const lastATR = atr.filter(v => v != null).pop() || lastPrice * 0.01;
  const multiplier = 1 + (1 - riskLevel) * 2; // conservative = 3×ATR, aggressive = 1×ATR
  const slPct = (lastATR * multiplier / lastPrice) * 100;
  return Math.round(slPct * 10) / 10;
}

// Suggest position size % based on risk level
function suggestPositionSize(riskLevel) {
  // conservative = 25% per trade, aggressive = 100%
  return Math.round((0.25 + riskLevel * 0.75) * 100);
}

// ── Current signal detection ─────────────────────────────────────
function currentSignal(net, rsiLast, riskLevel = 0.5) {
  const threshold = (1 - riskLevel) * 0.3;
  const lastSig = net[net.length - 1];
  const prevSig = net[net.length - 2];

  if (lastSig > threshold) return 'BUY';
  if (lastSig < -threshold) return 'SELL';

  // Use RSI as tiebreaker for hold context
  if (rsiLast != null) {
    if (rsiLast > 65) return 'WATCH-SELL';
    if (rsiLast < 35) return 'WATCH-BUY';
  }
  return 'HOLD';
}
