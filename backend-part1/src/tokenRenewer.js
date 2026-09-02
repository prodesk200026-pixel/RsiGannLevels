// ============================================================
// tokenRenewer.js
// Dhan does NOT have a TOTP/API-key silent login like Angel One.
// You still generate ONE access token manually from the Dhan web
// console (valid 24h). This module calls Dhan's /v2/RenewToken
// automatically on a schedule so that single token stays alive
// indefinitely — you should not need to touch the Dhan console again
// unless the token is manually revoked or the backend is down for
// longer than the renewal window.
// ============================================================

const cron = require('node-cron');
const cfg = require('./config');
const dhan = require('./dhanClient');

let lastRenewedAt = null;
let lastRenewResult = null;

async function renewIfDue() {
  if (!cfg.DHAN.ACCESS_TOKEN || !cfg.DHAN.CLIENT_ID) return;
  const dueBecauseNeverRun = !lastRenewedAt;
  const dueBecauseAged = lastRenewedAt && (Date.now() - lastRenewedAt) > cfg.DHAN.RENEW_INTERVAL_HOURS * 3600 * 1000;
  if (!dueBecauseNeverRun && !dueBecauseAged) return;

  const res = await dhan.renewToken();
  lastRenewResult = res;
  if (res.ok) {
    lastRenewedAt = Date.now();
    console.log('[tokenRenewer] Dhan token renewed OK at', new Date().toISOString());
  } else {
    console.error('[tokenRenewer] Dhan token renewal FAILED — you will need to generate a fresh token manually from the Dhan web console:', res.error);
  }
}

function start() {
  // Check every 30 min whether renewal is due (renew actually happens every ~20h)
  cron.schedule('*/30 * * * *', () => {
    renewIfDue().catch(e => console.error('[tokenRenewer] error', e.message));
  });
  // Also try once at boot (harmless if token is already fresh — Dhan just extends it)
  renewIfDue().catch(e => console.error('[tokenRenewer] boot renewal error', e.message));
}

function status() {
  return { lastRenewedAt, lastRenewResult: lastRenewResult?.ok ?? null };
}

module.exports = { start, status };
