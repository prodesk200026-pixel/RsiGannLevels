// ============================================================
// orderFlowEngine.js
// Maintains a rolling tick + depth history per underlying and derives
// an "ORDER FLOW PROXY" impulse score (0-100). Explicitly labeled a
// proxy because true exchange aggressor-side tape (who hit the bid vs
// lifted the ask) is not something Dhan's REST quote/depth exposes —
// this infers direction from price/volume/depth behaviour instead, per
// your own spec's "inferred order flow" requirement.
// ============================================================

const cfg = require('./config');

class SymbolFlowState {
  constructor(symbol) {
    this.symbol = symbol;
    this.history = []; // { t, ltp, volume, bidQty, askQty, bidPrice, askPrice }
    this.swingHighs = [];
    this.swingLows = [];
    this.lastStructure = 'NONE';
    this.lastImpulseAt = 0;
    this.followThroughLog = []; // { t, direction, entryPrice, resolved }
  }

  push(tick) {
    this.history.push(tick);
    const cutoff = Date.now() - Math.max(...cfg.WINDOWS_MS) - 5000;
    while (this.history.length > 2 && this.history[0].t < cutoff) this.history.shift();
    this._updateStructure();
  }

  windowSlice(ms) {
    const from = Date.now() - ms;
    return this.history.filter(h => h.t >= from);
  }

  _updateStructure() {
    // simple non-repainting swing detection: a point is a swing high/low only
    // once we have data on both sides of it (uses last 5 ticks, no look-ahead)
    const h = this.history;
    if (h.length < 5) return;
    const mid = h[h.length - 3];
    const isHigh = h.slice(-5).every(p => p.ltp <= mid.ltp);
    const isLow = h.slice(-5).every(p => p.ltp >= mid.ltp);
    if (isHigh) this.swingHighs.push(mid);
    if (isLow) this.swingLows.push(mid);
    if (this.swingHighs.length > 20) this.swingHighs.shift();
    if (this.swingLows.length > 20) this.swingLows.shift();
  }

  atr(periods = 14) {
    // ATR approximated from the tick history's 1-min-bucketed ranges since we
    // don't separately store OHLC candles here; good enough for a displacement gauge.
    const bucket = 60000;
    const buckets = {};
    for (const p of this.history) {
      const k = Math.floor(p.t / bucket);
      if (!buckets[k]) buckets[k] = { h: p.ltp, l: p.ltp };
      buckets[k].h = Math.max(buckets[k].h, p.ltp);
      buckets[k].l = Math.min(buckets[k].l, p.ltp);
    }
    const ranges = Object.values(buckets).map(b => b.h - b.l).slice(-periods);
    if (!ranges.length) return 1;
    return ranges.reduce((a, b) => a + b, 0) / ranges.length || 1;
  }
}

const states = new Map();
function stateFor(symbol) {
  if (!states.has(symbol)) states.set(symbol, new SymbolFlowState(symbol));
  return states.get(symbol);
}

function pct(a, b) { return b === 0 ? 0 : (a - b) / Math.abs(b); }

function computeMetrics(symbol) {
  const st = stateFor(symbol);
  const h = st.history;
  if (h.length < 3) return null;
  const latest = h[h.length - 1];

  const w1 = st.windowSlice(1000);
  const w5 = st.windowSlice(5000);
  const w15 = st.windowSlice(15000);
  const w60 = st.windowSlice(60000);

  // --- Tick velocity: ticks per second in last 5s window ---
  const tickVelocity = w5.length / 5;

  // --- Price velocity: price change per second over last 5s ---
  const priceVelocity = w5.length > 1 ? (w5[w5.length - 1].ltp - w5[0].ltp) / 5 : 0;

  // --- Volume acceleration: last 15s volume delta vs prior 15s volume delta ---
  const volDelta = (arr) => arr.length > 1 ? Math.max(0, arr[arr.length - 1].volume - arr[0].volume) : 0;
  const recentVolDelta = volDelta(w15);
  const priorVolDelta = volDelta(st.windowSlice(30000).filter(p => p.t < Date.now() - 15000));
  const volumeAcceleration = pct(recentVolDelta, priorVolDelta || 1);

  // --- Bid/Ask imbalance (from latest depth snapshot) ---
  const bidQ = latest.bidQty || 0, askQ = latest.askQty || 0;
  const depthImbalance = (bidQ + askQ) === 0 ? 0 : (bidQ - askQ) / (bidQ + askQ);

  // --- Liquidity consumption: compare successive depth snapshots against price direction ---
  let liquidityConsumed = false, liquiditySide = null;
  if (w5.length >= 3) {
    const first = w5[0], last = w5[w5.length - 1];
    const priceUp = last.ltp > first.ltp;
    const priceDown = last.ltp < first.ltp;
    const askDrained = first.askQty > 0 && last.askQty < first.askQty * 0.6;
    const bidDrained = first.bidQty > 0 && last.bidQty < first.bidQty * 0.6;
    if (priceUp && askDrained) { liquidityConsumed = true; liquiditySide = 'BUY_SIDE'; }
    if (priceDown && bidDrained) { liquidityConsumed = true; liquiditySide = 'SELL_SIDE'; }
  }

  // --- Displacement (x ATR) ---
  const atr = st.atr();
  const reference = w60.length ? w60[0].ltp : latest.ltp;
  const displacement = atr > 0 ? Math.abs(latest.ltp - reference) / atr : 0;
  let displacementBand = 'weak';
  if (displacement > cfg.DISPLACEMENT.strong) displacementBand = 'extreme';
  else if (displacement > cfg.DISPLACEMENT.moderate) displacementBand = 'strong';
  else if (displacement > cfg.DISPLACEMENT.weak) displacementBand = 'moderate';

  // --- Structure: break of last swing high/low ---
  let structure = 'NONE';
  const lastSwingHigh = st.swingHighs[st.swingHighs.length - 1];
  const lastSwingLow = st.swingLows[st.swingLows.length - 1];
  if (lastSwingHigh && latest.ltp > lastSwingHigh.ltp) structure = 'BULLISH_BREAK';
  if (lastSwingLow && latest.ltp < lastSwingLow.ltp) structure = 'BEARISH_BREAK';

  // --- Directional pressure (composite sign) ---
  const directionScore = (priceVelocity > 0 ? 1 : priceVelocity < 0 ? -1 : 0)
    + (depthImbalance > 0.15 ? 1 : depthImbalance < -0.15 ? -1 : 0)
    + (structure === 'BULLISH_BREAK' ? 1 : structure === 'BEARISH_BREAK' ? -1 : 0);
  const direction = directionScore > 0 ? 'BULLISH' : directionScore < 0 ? 'BEARISH' : 'NEUTRAL';

  // --- Follow-through: did price keep moving in the direction of the last displacement? ---
  const followThrough = w15.length > 3 &&
    ((direction === 'BULLISH' && w15[w15.length - 1].ltp >= w15[Math.floor(w15.length / 2)].ltp) ||
     (direction === 'BEARISH' && w15[w15.length - 1].ltp <= w15[Math.floor(w15.length / 2)].ltp));

  // ---------------- Confirmations (noise filter) ----------------
  const confirmations = [
    Math.abs(directionScore) >= 1,                       // directional pressure present
    Math.abs(volumeAcceleration) > 0.25,                  // volume accelerating
    Math.abs(depthImbalance) > 0.15,                      // depth imbalance meaningful
    liquidityConsumed,                                    // liquidity being consumed
    displacement > cfg.DISPLACEMENT.moderate,             // displacement at least moderate
    structure !== 'NONE'                                  // structure confirmation
  ];
  const confirmationCount = confirmations.filter(Boolean).length;

  // ---------------- Impulse score (weighted 0-100) ----------------
  const W = cfg.IMPULSE_WEIGHTS;
  const norm = (v, cap) => Math.max(0, Math.min(1, Math.abs(v) / cap));
  const score =
    W.directionalFlow * norm(directionScore, 3) +
    W.volumeAcceleration * norm(volumeAcceleration, 1.5) +
    W.bidAskImbalance * norm(depthImbalance, 0.6) +
    W.liquidityConsumption * (liquidityConsumed ? 1 : 0) +
    W.priceDisplacement * norm(displacement, cfg.DISPLACEMENT.strong * 1.2) +
    W.structureBreak * (structure !== 'NONE' ? 1 : 0) +
    W.followThrough * (followThrough ? 1 : 0) +
    W.tickVelocity * norm(tickVelocity, 3);

  let impulseScore = Math.round(Math.max(0, Math.min(100, score)));
  // Noise filter: force NO_TRADE-range score if not enough independent confirmations
  if (confirmationCount < cfg.MIN_CONFIRMATIONS) {
    impulseScore = Math.min(impulseScore, 39);
  }

  const band = cfg.SCORE_BANDS.find(b => impulseScore <= b.max) || cfg.SCORE_BANDS[cfg.SCORE_BANDS.length - 1];

  let state = band.state;
  if (state !== 'NO_TRADE') {
    if (direction === 'BULLISH') state = state.replace('IMPULSE', 'IMPULSE').startsWith('STRONG') || state.startsWith('HIGH') || state.startsWith('EXTREME')
      ? `BULLISH_${state}` : state;
    if (direction === 'BEARISH') state = state.startsWith('STRONG') || state.startsWith('HIGH') || state.startsWith('EXTREME')
      ? `BEARISH_${state}` : state;
  }

  return {
    symbol,
    ltp: latest.ltp,
    direction,
    tickVelocity: round2(tickVelocity),
    priceVelocity: round2(priceVelocity),
    volumeAcceleration: round2(volumeAcceleration),
    depthImbalance: round2(depthImbalance),
    liquidityConsumed,
    liquiditySide,
    displacement: round2(displacement),
    displacementBand,
    structure,
    followThrough,
    confirmationCount,
    minConfirmations: cfg.MIN_CONFIRMATIONS,
    impulseScore,
    scoreLabel: band.label,
    state,
    dataLabel: 'ORDER FLOW PROXY / INFERRED ORDER FLOW',
    ts: latest.t
  };
}

function round2(n) { return Math.round(n * 100) / 100; }

module.exports = { stateFor, computeMetrics };
