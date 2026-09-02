'use strict';
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');

const cfg = require('./config');
const store = require('./store');
const { initPush, broadcast } = require('./push');
const { StrategyEngine } = require('./strategy');
const { CrossoverWatcher } = require('./straddleIvWatcher');
const { DhanBroker } = require('./brokers/dhan');
const { AngelOneBroker } = require('./brokers/angelone');

const app = express();
app.use(cors());
app.use(express.json());
initPush(cfg);

const dhan = new DhanBroker(cfg);
const angel = new AngelOneBroker(cfg);

// ---- Per-index runtime state ----
const runtime = {}; // { NIFTY: { candles:[], call: StrategyEngine, put: StrategyEngine, straddleW, ivW, status:{} } }
for (const idx of cfg.trackIndices) {
  const strat = store.getStrategyConfig(idx, cfg.defaultStrategyConfig);
  runtime[idx] = {
    candles: [],
    call: new StrategyEngine(strat, 'CALL'),
    put: new StrategyEngine(strat, 'PUT'),
    straddleW: new CrossoverWatcher(`${idx} Straddle x Price`),
    ivW: new CrossoverWatcher(`${idx} IV x Price`),
    status: { lastUpdate: null, underlyingPrice: null, atmStrike: null, straddlePrice: null, atmIv: null, callState: 'IDLE', putState: 'IDLE', alerts: [] },
  };
}

function requireSecret(req, res, next) {
  const secret = req.header('x-api-secret') || req.query.secret;
  if (secret !== cfg.server.apiSecret) return res.status(401).json({ error: 'bad secret' });
  next();
}

function isMarketHoursNowIST() {
  if (!cfg.polling.marketHoursOnly) return true;
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const day = now.getDay();
  if (day === 0 || day === 6) return false;
  const mins = now.getHours() * 60 + now.getMinutes();
  return mins >= (9 * 60 + 15) && mins <= (15 * 60 + 30);
}

function fmtDateDhan(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
}

async function pollIndex(idx) {
  const meta = cfg.indexMap[idx];
  const rt = runtime[idx];
  if (!meta || !rt) return;

  // 1. candles for the RSI/EMA/Gann engine
  let candles = null;
  const useDhan = cfg.broker.mode !== 'angelone' && dhan.isConfigured();
  const useAngelFallback = cfg.broker.mode !== 'dhan' && angel.isConfigured();

  if (useDhan) {
    try {
      const to = new Date();
      const from = new Date(to.getTime() - 5 * 24 * 60 * 60 * 1000);
      candles = await dhan.getIntradayCandles(meta.securityId, meta.segment, rt.call.cfg.candleTimeframeMinutes, fmtDateDhan(from), fmtDateDhan(to));
    } catch (e) {
      console.error(`[${idx}] Dhan candle fetch failed:`, e.message);
    }
  }
  if ((!candles || !candles.length) && useAngelFallback) {
    try {
      // Angel One symbol tokens for indices must come from the scrip master; left as an
      // exercise wiring point — see README "Angel One index tokens" section.
      console.warn(`[${idx}] falling back to Angel One candles is not fully wired — see README.`);
    } catch (e) {
      console.error(`[${idx}] Angel One candle fetch failed:`, e.message);
    }
  }
  if (candles && candles.length) rt.candles = candles;

  // 2. option chain for straddle/IV + strike selection
  let optionChain = null;
  if (useDhan) {
    try {
      const expiries = await dhan.getExpiryList(meta.securityId, meta.segment);
      const nearestExpiry = expiries[0];
      if (nearestExpiry) optionChain = await dhan.getOptionChain(meta.securityId, meta.segment, nearestExpiry);
    } catch (e) {
      console.error(`[${idx}] Dhan option-chain fetch failed:`, e.message);
    }
  }

  // 3. run strategy engines on latest candles
  if (rt.candles.length) {
    const evCall = rt.call.update(rt.candles);
    const evPut = rt.put.update(rt.candles);
    rt.status.callState = rt.call.state;
    rt.status.putState = rt.put.state;
    for (const ev of [evCall, evPut].filter(Boolean)) {
      await handleStrategyEvent(idx, ev, optionChain, meta);
    }
  }

  // 4. straddle / IV crossover watchers
  if (optionChain) {
    const atm = DhanBroker.extractAtm(optionChain, meta.strikeStep);
    if (atm) {
      rt.status.underlyingPrice = atm.underlyingPrice;
      rt.status.atmStrike = atm.strike;
      rt.status.straddlePrice = atm.straddlePrice;
      rt.status.atmIv = atm.atmIv;
      const sEv = rt.straddleW.push(atm.underlyingPrice, atm.straddlePrice);
      const iEv = rt.ivW.push(atm.underlyingPrice, atm.atmIv);
      for (const ev of [sEv, iEv].filter(Boolean)) {
        rt.status.alerts.unshift({ ...ev, kind: 'CROSSOVER' });
        rt.status.alerts = rt.status.alerts.slice(0, 20);
        store.logSignal({ index: idx, ...ev, kind: 'CROSSOVER' });
        await notify(`${ev.name}`, `${ev.direction === 'UP' ? '🟢 Crossed UP' : '🔴 Crossed DOWN'} — Price ${ev.price.toFixed(1)} vs ${ev.indicatorValue.toFixed(1)}`);
      }
    }
  }

  rt.status.lastUpdate = new Date().toISOString();
}

async function handleStrategyEvent(idx, ev, optionChain, meta) {
  const rt = runtime[idx];
  rt.status.alerts.unshift({ ...ev, kind: 'STRATEGY' });
  rt.status.alerts = rt.status.alerts.slice(0, 20);
  store.logSignal({ index: idx, type: ev.type, direction: ev.direction, at: ev.at, kind: 'STRATEGY' });

  if (ev.type === 'GREEN_DOT') {
    await notify(`${idx} ${ev.direction} — Green Dot`, `Candle closed beyond double EMA. Watching next candle for Gann 0.25 break.`);
  }
  if (ev.type === 'ENTRY') {
    const side = ev.direction === 'CALL' ? 'ce' : 'pe';
    let strikePick = null;
    if (optionChain) {
      strikePick = DhanBroker.findStrikeInPremiumRange(optionChain, side, rt.call.cfg.strikePremiumMin, rt.call.cfg.strikePremiumMax);
    }
    const strikeMsg = strikePick
      ? `Suggested strike: ${strikePick.strike} ${side.toUpperCase()} @ ~${strikePick.leg.last_price}`
      : `No strike found in ₹${rt.call.cfg.strikePremiumMin}-${rt.call.cfg.strikePremiumMax} premium band right now.`;
    rt.status.alerts.unshift({ kind: 'ENTRY_CARD', index: idx, direction: ev.direction, strikePick, targets: ev.targets, at: Date.now() });
    await notify(`🚀 ${idx} ${ev.direction} ENTRY`, strikeMsg);
  }
}

async function notify(title, body) {
  const subs = store.getSubscriptions();
  if (!subs.length) return;
  await broadcast(subs, { title, body, tag: 'index-signal-' + Date.now() });
}

async function pollAll() {
  if (!isMarketHoursNowIST()) return;
  for (const idx of cfg.trackIndices) {
    try { await pollIndex(idx); } catch (e) { console.error(`[${idx}] poll error`, e.message); }
  }
}

// poll on an interval (node-cron needs a cron string; we just use setInterval for simplicity/precision)
setInterval(pollAll, cfg.polling.intervalSeconds * 1000);
pollAll();

// ---------------- HTTP API ----------------
app.get('/api/health', (req, res) => res.json({ ok: true, indices: cfg.trackIndices, brokerMode: cfg.broker.mode }));

app.get('/api/vapid-public-key', (req, res) => res.json({ publicKey: cfg.vapid.publicKey }));

app.post('/api/subscribe', requireSecret, (req, res) => {
  store.addSubscription(req.body);
  res.json({ ok: true });
});
app.post('/api/unsubscribe', requireSecret, (req, res) => {
  store.removeSubscription(req.body.endpoint);
  res.json({ ok: true });
});

app.get('/api/status', requireSecret, (req, res) => {
  const out = {};
  for (const idx of cfg.trackIndices) out[idx] = runtime[idx].status;
  res.json(out);
});

app.get('/api/config/:index', requireSecret, (req, res) => {
  const idx = req.params.index.toUpperCase();
  res.json(store.getStrategyConfig(idx, cfg.defaultStrategyConfig));
});
app.post('/api/config/:index', requireSecret, (req, res) => {
  const idx = req.params.index.toUpperCase();
  const merged = { ...cfg.defaultStrategyConfig, ...store.getStrategyConfig(idx, {}), ...req.body };
  store.setStrategyConfig(idx, merged);
  if (runtime[idx]) {
    runtime[idx].call.cfg = merged;
    runtime[idx].put.cfg = merged;
  }
  res.json(merged);
});

app.get('/api/signal-log', requireSecret, (req, res) => res.json(store.getSignalLog()));

app.listen(cfg.server.port, () => {
  console.log(`Index signal backend listening on :${cfg.server.port} | tracking ${cfg.trackIndices.join(', ')} | broker mode=${cfg.broker.mode}`);
});
