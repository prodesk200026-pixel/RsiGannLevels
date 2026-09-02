import { rma, smoothingLine } from './movingAverages.js';

/**
 * Classic Wilder RSI plus a selectable "smoothing line" laid over it —
 * this mirrors the reference screenshots exactly: RSI length 5 (purple
 * plot), Smoothing Line EMA, Smoothing Length 14 (blue plot), with
 * UpperLimit/MiddleLimit/LowerLimit at 70/50/30.
 *
 * Returns { rsi, signal, upper, middle, lower } — each a same-length
 * array aligned to the input `closes` array.
 */
export function computeRsiWithSignal(closes, opts = {}) {
  const length = opts.length ?? 5;
  const smoothingLength = opts.smoothingLength ?? 14;
  const smoothingType = opts.smoothingType ?? 'EMA';
  const midline = opts.midline ?? 50;

  const gains = new Array(closes.length).fill(null);
  const losses = new Array(closes.length).fill(null);
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    gains[i] = Math.max(diff, 0);
    losses[i] = Math.max(-diff, 0);
  }

  const avgGain = rma(gains, length);
  const avgLoss = rma(losses, length);

  const rsi = closes.map((_, i) => {
    if (avgGain[i] == null || avgLoss[i] == null) return null;
    if (avgLoss[i] === 0) return 100;
    const rs = avgGain[i] / avgLoss[i];
    return 100 - 100 / (1 + rs);
  });

  const signal = smoothingLine(rsi, smoothingLength, smoothingType);

  return {
    rsi,
    signal,
    upper: closes.map(() => opts.upper ?? 70),
    middle: closes.map(() => midline),
    lower: closes.map(() => opts.lower ?? 30),
  };
}
