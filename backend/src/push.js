// ============================================================
// push.js — VAPID web push, same pattern as your Ultimate Alert PWA.
// Works with the app closed / phone screen off. On some Android OEM
// skins (aggressive battery optimization), delivery can lag a few
// seconds unless the browser is whitelisted from battery optimization —
// that's an OS limitation, not something a backend can fully override.
// ============================================================

const webpush = require('web-push');
const cfg = require('./config');

let vapidReady = false;
if (cfg.VAPID.PUBLIC_KEY && cfg.VAPID.PRIVATE_KEY) {
  webpush.setVapidDetails(cfg.VAPID.SUBJECT, cfg.VAPID.PUBLIC_KEY, cfg.VAPID.PRIVATE_KEY);
  vapidReady = true;
}

const subscriptions = new Map(); // endpoint -> subscription object
const lastAlertAt = new Map();   // symbol -> timestamp, for cooldown

function subscribe(sub) {
  if (!sub || !sub.endpoint) return false;
  subscriptions.set(sub.endpoint, sub);
  return true;
}
function unsubscribe(endpoint) {
  return subscriptions.delete(endpoint);
}

async function broadcast(payload) {
  if (!vapidReady) return { ok: false, error: 'VAPID keys not configured on backend' };
  const body = JSON.stringify(payload);
  const results = [];
  for (const [endpoint, sub] of subscriptions.entries()) {
    try {
      await webpush.sendNotification(sub, body);
      results.push({ endpoint, ok: true });
    } catch (err) {
      results.push({ endpoint, ok: false, status: err.statusCode });
      if (err.statusCode === 404 || err.statusCode === 410) subscriptions.delete(endpoint); // expired
    }
  }
  return { ok: true, sent: results.length, results };
}

// Only push if this symbol hasn't alerted within cooldown window, and only for
// an actual actionable verdict (not WAIT) — prevents alert spam.
async function maybeAlert(symbol, signal) {
  if (!signal || signal.verdict === 'WAIT') return { ok: true, skipped: 'no-actionable-signal' };
  const last = lastAlertAt.get(symbol) || 0;
  if (Date.now() - last < cfg.ALERT_COOLDOWN_MS) return { ok: true, skipped: 'cooldown' };
  lastAlertAt.set(symbol, Date.now());
  const title = `${symbol}: ${signal.verdict === 'BUY_CALL' ? 'BUY CALL' : 'BUY PUT'} ${signal.strike}`;
  const body = `Premium ~₹${signal.premium ?? '?'} · confidence ${signal.confidence}/100 · ${signal.regime}`;
  return broadcast({ title, body, tag: symbol, data: signal });
}

function status() {
  return { vapidReady, subscriberCount: subscriptions.size };
}

module.exports = { subscribe, unsubscribe, broadcast, maybeAlert, status };
