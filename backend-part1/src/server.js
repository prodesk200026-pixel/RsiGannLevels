// ============================================================
// GAMMA X UNIFIED BACKEND — server.js
// PART 1 build: core server + Dhan auth/instruments only.
// Order-flow engine, GEX/hidden-Greeks engine, signal card, push
// alerts and /ws/market are added in PART 2 (routes.engines.js /
// server will require them once that file is dropped into src/).
// This file is written so Part 2 can be added WITHOUT editing this
// file — just drop the new files into src/ and they self-register.
// ============================================================

const express = require('express');
const cors = require('cors');
const cfg = require('./config');
const dhan = require('./dhanClient');
const instruments = require('./instruments');
const tokenRenewer = require('./tokenRenewer');

const app = express();
app.use(express.json());
app.use(cors({ origin: cfg.CORS_ORIGINS.includes('*') ? true : cfg.CORS_ORIGINS }));

// Crash-proofing (per your established pattern — 502s from unhandled errors, not just from Dhan)
process.on('unhandledRejection', (reason) => console.error('[unhandledRejection]', reason));
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err));

// ---------------- Health & status ----------------
app.get('/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

app.get('/api/status', (req, res) => {
  res.json({
    ok: true,
    service: 'gamma-x-unified-backend',
    part: 1,
    dhan: dhan.authStatus(),
    tokenRenewer: tokenRenewer.status(),
    underlyings: cfg.UNDERLYINGS,
    deepDepthSymbol: cfg.DEEP_DEPTH_SYMBOL,
    time: new Date().toISOString()
  });
});

// ---------------- Instruments ----------------
app.get('/api/instruments', async (req, res) => {
  try {
    const out = {};
    for (const u of cfg.UNDERLYINGS) {
      out[u] = await instruments.resolveIndex(u);
    }
    res.json({ ok: true, instruments: out });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/expiries/:underlying', async (req, res) => {
  try {
    const list = await instruments.listExpiries(req.params.underlying);
    res.json({ ok: true, underlying: req.params.underlying, expiries: list });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------- Raw passthrough test endpoints (useful while wiring Part 2) ----------------
app.get('/api/_debug/optionchain/:underlying', async (req, res) => {
  try {
    const idx = await instruments.resolveIndex(req.params.underlying);
    if (!idx) return res.status(404).json({ ok: false, error: 'underlying not resolved from scrip master' });
    const expiries = await instruments.listExpiries(req.params.underlying);
    const expiry = req.query.expiry || expiries[0];
    const chain = await dhan.getOptionChain(Number(idx.securityId), idx.exchangeSegment, expiry);
    res.json(chain);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------------- Part 2 auto-registration hook ----------------
// When Part 2 files (engines + routes) are dropped into src/, this loads them
// without needing to hand-edit this file again. registerPart2 may return an
// object with onServerReady(server) if it needs the raw http server (e.g. to
// attach a WebSocket server) — called once app.listen() has run below.
let part2Handle = null;
try {
  const registerPart2 = require('./registerPart2');
  part2Handle = registerPart2(app, { cfg, dhan, instruments });
  console.log('[server] Part 2 (engines/routes/push/ws) loaded.');
} catch (err) {
  if (err.code === 'MODULE_NOT_FOUND') {
    console.log('[server] Part 2 not present yet — running Part 1 (core) only.');
  } else {
    console.error('[server] Part 2 failed to load:', err.message);
  }
}

const server = app.listen(cfg.PORT, () => {
  console.log(`[server] Gamma X unified backend listening on :${cfg.PORT}`);
  tokenRenewer.start();
  if (part2Handle && typeof part2Handle.onServerReady === 'function') {
    part2Handle.onServerReady(server);
  }
});

module.exports = { app, server };
