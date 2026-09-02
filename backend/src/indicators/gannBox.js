/**
 * Gann Box, anchored the way it's described in the trading rules:
 *   - For a CALL setup: pullback candle LOW = ratio 0, pullback candle
 *     HIGH = ratio 0.25. Everything above 0.25 (0.5, 0.75, 1, 1.25 ...
 *     up to 3) is a projected target, extending the same box height
 *     upward.
 *   - For a PUT setup the box is mirrored: pullback candle HIGH = ratio
 *     0, LOW = ratio 0.25, and targets extend downward.
 *
 * `unit` is the 0 -> 0.25 distance (pullback candle's own high-low
 * range). Ratios beyond 1 are pure projections, same as dragging a
 * TradingView Gann Box handle past its own anchor box.
 */
export function buildGannBox({ direction, pullbackLow, pullbackHigh, ratios }) {
  const unit = (pullbackHigh - pullbackLow) / 0.25; // price distance representing "1.0 unit" of the box
  const zero = direction === 'CALL' ? pullbackLow : pullbackHigh;
  const sign = direction === 'CALL' ? 1 : -1;

  const levels = ratios.map((ratio) => ({
    ratio,
    price: zero + sign * unit * ratio,
  }));

  const entryLevel = levels.find((l) => l.ratio === 0.25);

  return { unit, zero, levels, entryLevel };
}

/** Has `price` reached/crossed a given Gann ratio level, in the trade direction? */
export function reachedLevel(direction, price, level) {
  if (!level) return false;
  return direction === 'CALL' ? price >= level.price : price <= level.price;
}
