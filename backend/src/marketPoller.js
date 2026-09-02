// ============================================================
// marketPoller.js
// The heartbeat of the backend: polls Dhan REST on a schedule, feeds
// orderFlowEngine + greeksEngine, computes the final signal, stores the
// latest snapshot per underlying, and broadcasts to WS + push.
//
// NOTE on option-chain field names: Dhan's documented v2 shape is an
// object keyed by strike under `data.oc`, each with `ce`/`pe` sub-objects
// (last_price, oi, implied_volatility, volume, top_bid_price,
// top_ask_price, top_bid_quantity, top_ask_quantity). normalizeChain()
// below targets that shape defensively with fallbacks. If your live
// account returns different field names, check GET
// /api/_debug/optionchain/:underlying on the deployed backend and adjust
// the field list in normalizeChain() — it's isolated to one function.
// ============================================================

const cfg = require('./config');
const dhan = require('./dhanClient');
const instruments = require('./instruments');
const orderFlow = require('./orderFlowEngine');
const greeks = require('./greeksEngine');
const signalEngine = require('./signalEngine');

const store = new Map(); // symbol -> { quote, chain, flow, gex, signal, updatedAt }
function getSnapshot(symbol) { return store.get(symbol) || null; }
function allSnapshots() {
  const out = {};
  for (const [k, v] of store.entries()) out[k] = v;
  return out;
}

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }

function normalizeChain(raw, expiry) {
  const oc = raw?.data?.oc || raw?.oc || {};
  const spot = num(raw?.data?.last_price ?? raw?.last_price);
  const rows = [];
  for (const strikeKey of Object.keys(oc)) {
    const strike = num(strikeKey);
    if (strike == null) continue;
    const ce = oc[strikeKey]?.ce || {};
    const pe = oc[strikeKey]?.pe || {};
    rows.push({
      strike,
      expiry,
      ce: {
        oi: num(ce.oi) || 0,
        iv: num(ce.implied_volatility ?? ce.iv) || 15,
        ltp: num(ce.last_price ?? ce.ltp),
        bid: num(ce.top_bid_price ?? ce.bid),
        ask: num(ce.top_ask_price ?? ce.ask),
        bidQty: num(ce.top_bid_quantity ?? ce.bidQty) || 0,
        askQty: num(ce.top_ask_quantity ?? ce.askQty) || 0,
        volume: num(ce.volume) || 0
      },
      pe: {
        oi: num(pe.oi) || 0,
        iv: num(pe.implied_volatility ?? pe.iv) || 15,
        ltp: num(pe.last_price ?? pe.ltp),
        bid: num(pe.top_bid_price ?? pe.bid),
        ask: num(pe.top_ask_price ?? pe.ask),
        bidQty: num(pe.top_bid_quantity ?? pe.bidQty) || 0,
        askQty: num(pe.top_ask_quantity ?? pe.askQty) || 0,
        volume: num(pe.volume) || 0
      }
    });
  }
  return { spot, rows };
}

async function pollQuoteOnce(symbol, idx) {
  const seg = { [idx.exchangeSegment]: [Number(idx.securityId)] };
  const res = await dhan.getQuote(seg);
  if (!res.ok) return null;
  const segData = res.data?.data?.[idx.exchangeSegment] || {};
  const row = segData[idx.securityId] || Object.values(segData)[0];
  if (!row) return null;
  return {
    ltp: num(row.last_price ?? row.LTP ?? row.ltp),
    volume: num(row.volume ?? row.Volume) || 0,
    depth: row.depth || null // some Dhan quote responses include a top-of-book depth object
  };
}

async function pollChainOnce(symbol, idx) {
  const expiries = await instruments.listExpiries(symbol);
  const expiry = expiries[0];
  if (!expiry) return null;
  const res = await dhan.getOptionChain(Number(idx.securityId), idx.exchangeSegment, expiry);
  if (!res.ok) return null;
  return normalizeChain(res.data, expiry);
}

async function tick(symbol, wsHub, push) {
  const idx = await instruments.resolveIndex(symbol);
  if (!idx) return;

  const q = await pollQuoteOnce(symbol, idx);
  if (!q || q.ltp == null) return;

  const prevSnap = store.get(symbol);
  const chainData = prevSnap?.chain || null;
  const atmStrike = chainData ? Math.round(q.ltp / 50) * 50 : null;
  const atmRow = chainData?.rows?.find(r => r.strike === atmStrike);

  orderFlow.stateFor(symbol).push({
    t: Date.now(),
    ltp: q.ltp,
    volume: q.volume,
    bidQty: (atmRow?.ce.bidQty || 0) + (atmRow?.pe.bidQty || 0),
    askQty: (atmRow?.ce.askQty || 0) + (atmRow?.pe.askQty || 0)
  });

  const flow = orderFlow.computeMetrics(symbol);
  const gex = chainData && chainData.rows.length
    ? greeks.analyzeChain(q.ltp, chainData.rows)
    : (prevSnap?.gex || null);
  const signal = (flow && gex) ? signalEngine.buildSignal(symbol, flow, gex) : { symbol, verdict: 'WAIT', reason: 'warming up', ts: Date.now() };

  const snapshot = { quote: q, chain: chainData, flow, gex, signal, updatedAt: Date.now() };
  store.set(symbol, snapshot);

  wsHub.broadcast({ type: 'market_update', symbol, ltp: q.ltp, flow, signal, ts: Date.now() });
  if (signal.verdict !== 'WAIT') await push.maybeAlert(symbol, signal);
}

async function chainTick(symbol) {
  const idx = await instruments.resolveIndex(symbol);
  if (!idx) return;
  const chain = await pollChainOnce(symbol, idx);
  if (!chain || !chain.rows.length) return;
  const prev = store.get(symbol) || {};
  store.set(symbol, { ...prev, chain, updatedAt: Date.now() });
}

function start(wsHub, push) {
  for (const symbol of cfg.UNDERLYINGS) {
    setInterval(() => tick(symbol, wsHub, push).catch(e => console.error(`[poller:${symbol}]`, e.message)), cfg.POLL.QUOTE_MS);
    setInterval(() => chainTick(symbol).catch(e => console.error(`[poller:${symbol}:chain]`, e.message)), cfg.POLL.OPTION_CHAIN_MS);
    chainTick(symbol).catch(() => {});
    tick(symbol, wsHub, push).catch(() => {});
  }
  console.log('[marketPoller] started for', cfg.UNDERLYINGS.join(', '));
}

module.exports = { start, getSnapshot, allSnapshots };
