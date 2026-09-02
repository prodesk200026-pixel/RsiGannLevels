// Moving average building blocks shared by RSI smoothing, the "double EMA"
// trend filter, and anything else that needs a plain series transform.
// All functions accept an array that may contain nulls (warm-up period)
// and return an array of the same length.

export function sma(values, length) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    sum += v ?? 0;
    if (i >= length) sum -= values[i - length] ?? 0;
    if (i >= length - 1 && values.slice(i - length + 1, i + 1).every((x) => x != null)) {
      out[i] = sum / length;
    }
  }
  return out;
}

export function ema(values, length) {
  const out = new Array(values.length).fill(null);
  const k = 2 / (length + 1);
  let prev = null;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null) continue;
    if (prev == null) {
      prev = v;
    } else {
      prev = v * k + prev * (1 - k);
    }
    out[i] = prev;
  }
  return out;
}

// Wilder's RMA (used internally by classic RSI, and offered as a
// selectable "Smoothing Line" option to match the TradingView-style
// RSI settings panel supplied as reference: EMA / SMA / RMA).
export function rma(values, length) {
  const out = new Array(values.length).fill(null);
  let prev = null;
  let seedSum = 0;
  let seedCount = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null) continue;
    if (prev == null) {
      seedSum += v;
      seedCount++;
      if (seedCount === length) {
        prev = seedSum / length;
        out[i] = prev;
      }
      continue;
    }
    prev = (prev * (length - 1) + v) / length;
    out[i] = prev;
  }
  return out;
}

export function smoothingLine(values, length, type = 'EMA') {
  if (type === 'SMA') return sma(values, length);
  if (type === 'RMA') return rma(values, length);
  return ema(values, length);
}

// Crossover helpers: did `a` cross above/below `b` between index i-1 and i.
export function crossedAbove(a, b, i) {
  if (a[i - 1] == null || b[i - 1] == null || a[i] == null || b[i] == null) return false;
  return a[i - 1] <= b[i - 1] && a[i] > b[i];
}

export function crossedBelow(a, b, i) {
  if (a[i - 1] == null || b[i - 1] == null || a[i] == null || b[i] == null) return false;
  return a[i - 1] >= b[i - 1] && a[i] < b[i];
}
