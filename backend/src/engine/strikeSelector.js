/**
 * "Prefer strike price between 5 to 30, whether call or put."
 * Given an enriched option-chain snapshot and a direction, pick the
 * strike whose LTP is inside [min, max], closest to the midpoint of
 * that band (avoids grabbing the absolute cheapest/most-decayed
 * contract, or one so expensive it barely fits the band).
 */
export function selectStrike(enrichedChain, direction, { min = 5, max = 30 } = {}) {
  const side = direction === 'CALL' ? 'ce' : 'pe';
  const mid = (min + max) / 2;

  const candidates = enrichedChain.rows
    .map((r) => r[side] && { ...r[side], strike: r.strike })
    .filter((c) => c && c.ltp >= min && c.ltp <= max);

  if (!candidates.length) return null;

  candidates.sort((a, b) => Math.abs(a.ltp - mid) - Math.abs(b.ltp - mid));
  const pick = candidates[0];

  return {
    strike: pick.strike,
    type: side === 'ce' ? 'CE' : 'PE',
    ltp: pick.ltp,
    oi: pick.oi,
    changeInOi: pick.changeInOi,
    volume: pick.volume,
    changeInVolume: pick.changeInVolume,
    iv: pick.iv,
    delta: pick.delta,
    gamma: pick.gamma,
    theta: pick.theta,
    vega: pick.vega,
  };
}
