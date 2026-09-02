// ============================================================
// registerPart2.js — auto-loaded by server.js once this file exists.
// Adds all Part 2 routes + starts the poller + attaches /ws/market.
// ============================================================

const wsHub = require('./wsHub');
const push = require('./push');
const poller = require('./marketPoller');
const cfg = require('./config');

module.exports = function registerPart2(app, { instruments }) {

  // ---------------- Sanitized config (no secrets) ----------------
  app.get('/api/config', (req, res) => {
    res.json({
      ok: true,
      underlyings: cfg.UNDERLYINGS,
      impulseWeights: cfg.IMPULSE_WEIGHTS,
      scoreBands: cfg.SCORE_BANDS,
      displacement: cfg.DISPLACEMENT,
      minConfirmations: cfg.MIN_CONFIRMATIONS,
      exitPlan: cfg.EXIT_PLAN,
      alertCooldownMs: cfg.ALERT_COOLDOWN_MS,
      vapidPublicKey: cfg.VAPID.PUBLIC_KEY || null,
      pushReady: push.status().vapidReady
    });
  });

  // ---------------- Market / order flow / signals / options / depth ----------------
  app.get('/api/market/:symbol', (req, res) => {
    const snap = poller.getSnapshot(req.params.symbol.toUpperCase());
    if (!snap) return res.status(404).json({ ok: false, error: 'no data yet for this symbol' });
    res.json({ ok: true, symbol: req.params.symbol.toUpperCase(), quote: snap.quote, updatedAt: snap.updatedAt });
  });

  app.get('/api/orderflow/:symbol', (req, res) => {
    const snap = poller.getSnapshot(req.params.symbol.toUpperCase());
    if (!snap) return res.status(404).json({ ok: false, error: 'no data yet' });
    res.json({ ok: true, flow: snap.flow, updatedAt: snap.updatedAt });
  });

  app.get('/api/options/:symbol', (req, res) => {
    const snap = poller.getSnapshot(req.params.symbol.toUpperCase());
    if (!snap) return res.status(404).json({ ok: false, error: 'no data yet' });
    res.json({ ok: true, gex: snap.gex, updatedAt: snap.updatedAt });
  });

  app.get('/api/depth/:symbol', (req, res) => {
    const snap = poller.getSnapshot(req.params.symbol.toUpperCase());
    if (!snap) return res.status(404).json({ ok: false, error: 'no data yet' });
    res.json({
      ok: true,
      symbol: req.params.symbol.toUpperCase(),
      depthImbalance: snap.flow?.depthImbalance ?? null,
      liquidityConsumed: snap.flow?.liquidityConsumed ?? null,
      liquiditySide: snap.flow?.liquiditySide ?? null,
      callWall: snap.gex?.callWall ?? null,
      putWall: snap.gex?.putWall ?? null,
      updatedAt: snap.updatedAt
    });
  });

  app.get('/api/signals', (req, res) => {
    const all = poller.allSnapshots();
    const out = {};
    for (const sym of Object.keys(all)) out[sym] = all[sym].signal;
    res.json({ ok: true, signals: out, ts: Date.now() });
  });

  app.get('/api/signals/:symbol', (req, res) => {
    const snap = poller.getSnapshot(req.params.symbol.toUpperCase());
    if (!snap) return res.status(404).json({ ok: false, error: 'no data yet' });
    res.json({ ok: true, signal: snap.signal, updatedAt: snap.updatedAt });
  });

  // ---------------- Wall-Sniper-compatible route ----------------
  // Lets your EXISTING Wall Sniper PWA point its backend URL field at THIS
  // unified backend and keep working unmodified — same response shape it
  // already expects (resistance/support/PCR/wait-or-side card).
  app.get('/wall-sniper-signal', (req, res) => {
    const symbol = (req.query.index || req.query.symbol || 'NIFTY').toUpperCase();
    const snap = poller.getSnapshot(symbol);
    if (!snap) return res.status(200).json({ ok: true, state: 'WAIT', reason: 'stale/no data', symbol });
    const s = snap.signal || {};
    res.json({
      ok: true,
      symbol,
      spot: snap.quote?.ltp ?? null,
      pcr: snap.gex?.pcr ?? null,
      resistance: snap.gex?.callWall ?? null, // Call Wall
      support: snap.gex?.putWall ?? null,     // Put Wall
      state: s.verdict === 'BUY_CALL' ? 'BUY_CALL' : s.verdict === 'BUY_PUT' ? 'BUY_PUT' : 'WAIT',
      strike: s.strike ?? null,
      optionType: s.optionType ?? null,
      premium: s.premium ?? null,
      confidence: s.confidence ?? null,
      exitPlan: s.exitPlan ?? null,
      reasons: s.reasons ?? [],
      updatedAt: snap.updatedAt
    });
  });

  // ---------------- Push subscribe / test ----------------
  app.post('/api/push/subscribe', (req, res) => {
    const ok = push.subscribe(req.body);
    res.json({ ok });
  });
  app.post('/api/push/unsubscribe', (req, res) => {
    const ok = push.unsubscribe(req.body?.endpoint);
    res.json({ ok });
  });
  app.post('/api/push/test', async (req, res) => {
    const result = await push.broadcast({ title: 'Gamma X test alert', body: 'Push is working ✅', tag: 'test' });
    res.json(result);
  });
  app.get('/api/push/status', (req, res) => res.json(push.status()));

  // ---------------- Start poller once server + WS are up ----------------
  return {
    onServerReady(server) {
      wsHub.attach(server);
      poller.start(wsHub, push);
    }
  };
};
