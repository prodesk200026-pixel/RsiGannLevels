// ============================================================
// signalEngine.js
// Combines orderFlowEngine output + greeksEngine (GEX/dealer regime/walls)
// into ONE final card: BUY CALL / BUY PUT / WAIT — with your standard
// fixed exit plan attached. No accuracy % is ever printed on this card;
// "confidence" reflects how many independent things agree, not a promise.
// ============================================================

const cfg = require('./config');

function pickStrike(spot, side, step = 50) {
  const atm = Math.round(spot / step) * step;
  // slight OTM bias (1 step) toward cheaper premium, matching his existing terminals' pattern
  return side === 'CE' ? atm + step : atm - step;
}

function buildSignal(symbol, flow, gex) {
  if (!flow || !gex) {
    return { symbol, verdict: 'WAIT', reason: 'Waiting for enough live data to compute a signal.', ts: Date.now() };
  }

  const reasons = [];
  let side = null; // 'CE' | 'PE'
  let confidencePoints = 0;

  // ---- Order flow direction + impulse strength ----
  const flowBullish = flow.direction === 'BULLISH' && flow.impulseScore >= 55;
  const flowBearish = flow.direction === 'BEARISH' && flow.impulseScore >= 55;
  if (flowBullish) { confidencePoints += 30; reasons.push(`Order flow: BULLISH impulse ${flow.impulseScore}/100 (${flow.scoreLabel})`); }
  if (flowBearish) { confidencePoints += 30; reasons.push(`Order flow: BEARISH impulse ${flow.impulseScore}/100 (${flow.scoreLabel})`); }

  // ---- Dealer gamma regime ----
  if (gex.regime === 'SHORT_GAMMA') {
    reasons.push('Dealers net SHORT gamma — moves likely to amplify, favors breakout continuation.');
    confidencePoints += flowBullish || flowBearish ? 20 : 5;
  } else {
    reasons.push('Dealers net LONG gamma — moves likely to dampen, favors fading extremes near walls.');
  }

  // ---- Wall proximity (support/resistance from OI) ----
  const nearPutWall = gex.putWall && Math.abs(gex.spot - gex.putWall) / gex.spot < 0.003;
  const nearCallWall = gex.callWall && Math.abs(gex.spot - gex.callWall) / gex.spot < 0.003;
  if (nearPutWall) { reasons.push(`Price near Put Wall (support) ${gex.putWall} — OI-defended level.`); confidencePoints += 10; }
  if (nearCallWall) { reasons.push(`Price near Call Wall (resistance) ${gex.callWall} — OI-defended level.`); confidencePoints += 10; }

  // ---- Gamma-flip proximity (extra structural level) ----
  if (gex.gammaFlipStrike && Math.abs(gex.spot - gex.gammaFlipStrike) / gex.spot < 0.004) {
    reasons.push(`Price near Gamma-Flip strike ${gex.gammaFlipStrike} — regime transition zone.`);
    confidencePoints += 10;
  }

  // ---- Decide side ----
  if (gex.regime === 'LONG_GAMMA') {
    // long-gamma world: favor fade at walls, not the raw flow direction
    if (nearCallWall) side = 'PE';
    else if (nearPutWall) side = 'CE';
    else if (flowBullish) side = 'CE';
    else if (flowBearish) side = 'PE';
  } else {
    // short-gamma world: favor continuation with flow
    if (flowBullish) side = 'CE';
    else if (flowBearish) side = 'PE';
  }

  const confirmationsOk = flow.confirmationCount >= cfg.MIN_CONFIRMATIONS;
  if (!confirmationsOk) reasons.push(`Only ${flow.confirmationCount}/${cfg.MIN_CONFIRMATIONS} confirmations — below minimum, defaulting to WAIT.`);

  if (!side || !confirmationsOk || confidencePoints < 45) {
    return {
      symbol,
      verdict: 'WAIT',
      spot: gex.spot,
      reasons: reasons.length ? reasons : ['No aligned confirmations yet.'],
      confidence: Math.min(confidencePoints, 44),
      regime: gex.regime,
      callWall: gex.callWall,
      putWall: gex.putWall,
      gammaFlipStrike: gex.gammaFlipStrike,
      pcr: gex.pcr,
      ts: Date.now()
    };
  }

  const strike = pickStrike(gex.spot, side);
  const strikeRow = gex.perStrike.find(r => r.strike === strike);
  const legPrice = side === 'CE' ? strikeRow?.call?.ltp : strikeRow?.put?.ltp;
  const premium = legPrice || null;

  const exit = cfg.EXIT_PLAN;
  const plan = premium ? {
    stopLoss: round(premium * (1 + exit.stopLossPct / 100)),
    bookHalfAt: round(premium * exit.bookHalfAtMultiple),
    trailGivebackPct: exit.trailGivebackPct
  } : null;

  return {
    symbol,
    verdict: side === 'CE' ? 'BUY_CALL' : 'BUY_PUT',
    spot: gex.spot,
    strike,
    optionType: side,
    premium,
    confidence: Math.min(Math.round(confidencePoints), 95), // capped — never claims certainty
    reasons,
    exitPlan: plan,
    regime: gex.regime,
    callWall: gex.callWall,
    putWall: gex.putWall,
    gammaFlipStrike: gex.gammaFlipStrike,
    pcr: gex.pcr,
    orderFlow: { impulseScore: flow.impulseScore, state: flow.state, direction: flow.direction },
    disclaimer: 'Confidence reflects how many independent signals agree right now, not a win-rate promise.',
    ts: Date.now()
  };
}

function round(n) { return n == null ? null : Math.round(n * 100) / 100; }

module.exports = { buildSignal };
