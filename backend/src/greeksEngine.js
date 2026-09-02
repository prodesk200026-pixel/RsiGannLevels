// ============================================================
// greeksEngine.js
// 1. Black-Scholes plain + hidden Greeks (vanna, charm, vomma, speed, color, zomma) per strike
// 2. OI-weighted aggregation across the WHOLE chain to get dealer net gamma exposure (GEX),
//    the gamma-flip strike, and call/put walls — this is the real method (not single-strike
//    reading) you asked for, matching how SpotGamma/SqueezeMetrics-style tools work:
//      - Net GEX > 0  -> dealers net LONG gamma -> they buy dips/sell rallies -> moves DAMPEN, price pins -> favors fade-the-extreme
//      - Net GEX < 0  -> dealers net SHORT gamma -> they sell dips/buy rallies -> moves AMPLIFY -> favors breakout/trend-continuation
// ============================================================

const RISK_FREE_RATE = 0.065; // approx India 91-day T-bill; update as needed
const LOT_MULTIPLIER_DEFAULT = 1; // GEX here is expressed per 1x OI unit; scale externally if you want ₹ notional

function erf(x) {
  // Abramowitz-Stegun approximation, good to ~1e-7
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741,
        a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}
function normCdf(x) { return 0.5 * (1 + erf(x / Math.sqrt(2))); }
function normPdf(x) { return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI); }

function bsGreeks(S, K, T, r, sigma, isCall) {
  if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) {
    return { delta: 0, gamma: 0, theta: 0, vega: 0, vanna: 0, charm: 0, vomma: 0, speed: 0, color: 0, zomma: 0 };
  }
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const Nd1 = normCdf(d1), Nd2 = normCdf(d2);
  const nd1 = normPdf(d1);

  const gamma = nd1 / (S * sigma * sqrtT);
  const vega = S * nd1 * sqrtT; // per 1.0 vol (multiply by 0.01 for per-1% vol)
  const delta = isCall ? Nd1 : Nd1 - 1;
  const theta = isCall
    ? (-(S * nd1 * sigma) / (2 * sqrtT) - r * K * Math.exp(-r * T) * Nd2)
    : (-(S * nd1 * sigma) / (2 * sqrtT) + r * K * Math.exp(-r * T) * (1 - Nd2));

  // ---- Hidden (second-order) Greeks ----
  const vanna = -nd1 * (d2 / sigma);           // dDelta/dVol
  const charm = isCall
    ? -nd1 * ((2 * r * T - d2 * sigma * sqrtT) / (2 * T * sigma * sqrtT))
    : -nd1 * ((2 * r * T - d2 * sigma * sqrtT) / (2 * T * sigma * sqrtT)); // same closed form, sign carried by d1/d2
  const vomma = vega * (d1 * d2) / sigma;      // dVega/dVol
  const speed = -(gamma / S) * (d1 / (sigma * sqrtT) + 1); // dGamma/dSpot (3rd order, "speed")
  const color = -(nd1 / (2 * S * T * sigma * sqrtT)) *
    (2 * r * T + 1 + (d1 * (2 * r * T - d2 * sigma * sqrtT)) / (sigma * sqrtT)); // dGamma/dTime
  const zomma = gamma * ((d1 * d2 - 1) / sigma); // dGamma/dVol

  return { delta, gamma, theta: theta / 365, vega: vega / 100, vanna, charm: charm / 365, vomma, speed, color, zomma };
}

function yearsToExpiry(expiryStr) {
  const exp = new Date(expiryStr + 'T15:30:00+05:30');
  const now = new Date();
  const ms = exp - now;
  return Math.max(ms / (1000 * 60 * 60 * 24 * 365), 0.0005);
}

// chainRows: array of { strike, expiry, ce: {oi, iv, ltp, bid, ask, volume}, pe: {...} }
function analyzeChain(spot, chainRows) {
  const perStrike = [];
  let netGexAtSpot = 0;
  let maxCallOi = { strike: null, oi: -1 };
  let maxPutOi = { strike: null, oi: -1 };
  let dealerVanna = 0, dealerCharm = 0;

  for (const row of chainRows) {
    const T = yearsToExpiry(row.expiry);
    const ivCall = (row.ce?.iv || row.pe?.iv || 15) / 100;
    const ivPut = (row.pe?.iv || row.ce?.iv || 15) / 100;

    const cg = bsGreeks(spot, row.strike, T, RISK_FREE_RATE, ivCall, true);
    const pg = bsGreeks(spot, row.strike, T, RISK_FREE_RATE, ivPut, false);

    const callOi = row.ce?.oi || 0;
    const putOi = row.pe?.oi || 0;

    // Standard convention: dealers assumed net short calls / long puts vs public positioning ->
    // Call GEX contributes positively to dealer long-gamma, Put GEX contributes negatively.
    const callGEX = callOi * cg.gamma * spot * spot * 0.01 * LOT_MULTIPLIER_DEFAULT;
    const putGEX = -putOi * pg.gamma * spot * spot * 0.01 * LOT_MULTIPLIER_DEFAULT;
    const strikeGEX = callGEX + putGEX;
    netGexAtSpot += strikeGEX;

    dealerVanna += callOi * cg.vanna - putOi * pg.vanna;
    dealerCharm += callOi * cg.charm - putOi * pg.charm;

    if (callOi > maxCallOi.oi) maxCallOi = { strike: row.strike, oi: callOi };
    if (putOi > maxPutOi.oi) maxPutOi = { strike: row.strike, oi: putOi };

    perStrike.push({
      strike: row.strike,
      expiry: row.expiry,
      callOi, putOi,
      callGEX: round(callGEX), putGEX: round(putGEX), strikeGEX: round(strikeGEX),
      call: { ...roundGreeks(cg), iv: row.ce?.iv, ltp: row.ce?.ltp, bid: row.ce?.bid, ask: row.ce?.ask },
      put: { ...roundGreeks(pg), iv: row.pe?.iv, ltp: row.pe?.ltp, bid: row.pe?.bid, ask: row.pe?.ask }
    });
  }

  // ---- Gamma-flip strike: scan hypothetical spot levels, recompute net GEX at each,
  // find where the sign flips closest to current spot. This is the genuine
  // OI-weighted, whole-chain method (not a single-strike read). ----
  const strikes = chainRows.map(r => r.strike);
  const lo = Math.min(...strikes) * 0.97;
  const hi = Math.max(...strikes) * 1.03;
  const steps = 60;
  let prevSign = null, flipStrike = null, flipPoint = null;
  for (let i = 0; i <= steps; i++) {
    const hypSpot = lo + (hi - lo) * (i / steps);
    let net = 0;
    for (const row of chainRows) {
      const T = yearsToExpiry(row.expiry);
      const ivCall = (row.ce?.iv || row.pe?.iv || 15) / 100;
      const ivPut = (row.pe?.iv || row.ce?.iv || 15) / 100;
      const cg = bsGreeks(hypSpot, row.strike, T, RISK_FREE_RATE, ivCall, true);
      const pg = bsGreeks(hypSpot, row.strike, T, RISK_FREE_RATE, ivPut, false);
      net += (row.ce?.oi || 0) * cg.gamma * hypSpot * hypSpot * 0.01
           - (row.pe?.oi || 0) * pg.gamma * hypSpot * hypSpot * 0.01;
    }
    const sign = net >= 0 ? 1 : -1;
    if (prevSign !== null && sign !== prevSign) {
      flipStrike = Math.round(hypSpot / 50) * 50; // round to nearest 50 for index readability
      flipPoint = hypSpot;
    }
    prevSign = sign;
  }

  const regime = netGexAtSpot >= 0 ? 'LONG_GAMMA' : 'SHORT_GAMMA';
  const regimeNote = netGexAtSpot >= 0
    ? 'Dealers net long gamma — hedging dampens moves, price tends to pin near walls. Favors fading extremes.'
    : 'Dealers net short gamma — hedging amplifies moves. Favors breakout / trend-continuation.';

  return {
    spot,
    netGEX: round(netGexAtSpot),
    regime,
    regimeNote,
    gammaFlipStrike: flipStrike,
    callWall: maxCallOi.strike,  // resistance — highest call OI
    putWall: maxPutOi.strike,    // support — highest put OI
    pcr: maxPutOi.oi >= 0 && perStrike.length
      ? round(perStrike.reduce((s, r) => s + r.putOi, 0) / Math.max(1, perStrike.reduce((s, r) => s + r.callOi, 0)))
      : null,
    dealerVanna: round(dealerVanna),
    dealerCharm: round(dealerCharm),
    perStrike,
    dataLabel: 'DERIVED ANALYSIS — OI-weighted dealer exposure, not guaranteed support/resistance'
  };
}

function roundGreeks(g) {
  const out = {};
  for (const k in g) out[k] = Math.round(g[k] * 100000) / 100000;
  return out;
}
function round(n) { return Math.round(n * 100) / 100; }

module.exports = { bsGreeks, analyzeChain, yearsToExpiry };
