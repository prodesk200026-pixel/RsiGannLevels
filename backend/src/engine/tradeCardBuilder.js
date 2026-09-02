/**
 * Turns an ENTRY_SIGNAL + selected strike + chain context into the
 * same card shape as the reference screenshots:
 *   SL = -35% of premium ("bina soche OUT" = exit without hesitation)
 *   Target = 2x premium ("aadha book" = book half there)
 *   Trailing = exit the rest if price falls 30% off its post-entry peak
 */
export function buildTradeCard({ direction, strikeInfo, chainContext }) {
  const entry = strikeInfo.ltp;
  const stopLoss = +(entry * 0.65).toFixed(2); // -35%
  const target = +(entry * 2).toFixed(2); // 2x

  const wallNote = direction === 'CALL'
    ? `Support/Put-Wall strike — the level being defended`
    : `Resistance/Call-Wall strike — the level being defended`;

  // Simple, explainable confidence score out of 100 — not a black box.
  let confidence = 50;
  if (strikeInfo.changeInOi > 0) confidence += 15;
  if (strikeInfo.changeInVolume > 0) confidence += 15;
  if (chainContext?.pcr != null) {
    if (direction === 'CALL' && chainContext.pcr > 1) confidence += 10;
    if (direction === 'PUT' && chainContext.pcr < 1) confidence += 10;
  }
  confidence = Math.max(5, Math.min(95, confidence));

  return {
    action: direction === 'CALL' ? 'BUY CALL' : 'BUY PUT',
    strike: strikeInfo.strike,
    optionType: strikeInfo.type,
    entryPrice: entry,
    confidence,
    note: wallNote,
    stopLoss: { price: stopLoss, pct: -35, label: 'bina soche OUT' },
    target: { price: target, multiple: '2x', label: 'aadha BOOK' },
    trailing: { pctOffPeak: -30, label: 'baaki bhi OUT' },
    greeks: {
      delta: strikeInfo.delta,
      gamma: strikeInfo.gamma,
      theta: strikeInfo.theta,
      vega: strikeInfo.vega,
    },
    oi: strikeInfo.oi,
    changeInOi: strikeInfo.changeInOi,
    volume: strikeInfo.volume,
    changeInVolume: strikeInfo.changeInVolume,
    iv: strikeInfo.iv,
  };
}
