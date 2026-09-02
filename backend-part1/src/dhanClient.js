// ============================================================
// dhanClient.js — thin wrapper around Dhan v2 REST Data APIs
// Never exposes CLIENT_ID / ACCESS_TOKEN outside this backend.
// ============================================================

const axios = require('axios');
const cfg = require('./config');

function headers() {
  return {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'access-token': cfg.DHAN.ACCESS_TOKEN,
    'client-id': cfg.DHAN.CLIENT_ID
  };
}

const client = axios.create({
  baseURL: cfg.DHAN.BASE_URL,
  timeout: 8000
});

let lastAuthError = null;
let lastAuthErrorAt = 0;

async function safeCall(fn) {
  try {
    const res = await fn();
    lastAuthError = null;
    return { ok: true, data: res.data };
  } catch (err) {
    const status = err.response?.status;
    const body = err.response?.data;
    if (status === 401 || status === 403) {
      lastAuthError = body?.errorMessage || body?.remarks || 'Dhan auth rejected (token expired or invalid)';
      lastAuthErrorAt = Date.now();
    }
    return { ok: false, status, error: body || err.message };
  }
}

function authStatus() {
  return {
    hasCredentials: !!(cfg.DHAN.CLIENT_ID && cfg.DHAN.ACCESS_TOKEN),
    lastAuthError,
    lastAuthErrorAt
  };
}

// ---- Market Quote (LTP / OHLC / Quote with OI, up to 1000 instruments per call) ----
// body shape per Dhan v2 docs: { "NSE_EQ": [11536], "NSE_FNO": [49081, 49082] }
async function getQuote(securityIdsBySegment) {
  return safeCall(() => client.post('/marketfeed/quote', securityIdsBySegment, { headers: headers() }));
}

async function getLtp(securityIdsBySegment) {
  return safeCall(() => client.post('/marketfeed/ltp', securityIdsBySegment, { headers: headers() }));
}

async function getOhlc(securityIdsBySegment) {
  return safeCall(() => client.post('/marketfeed/ohlc', securityIdsBySegment, { headers: headers() }));
}

// ---- Option Chain ----
async function getOptionChain(underlyingScrip, underlyingSeg, expiry) {
  return safeCall(() => client.post('/optionchain', {
    UnderlyingScrip: underlyingScrip,
    UnderlyingSeg: underlyingSeg,
    Expiry: expiry
  }, { headers: headers() }));
}

async function getExpiryList(underlyingScrip, underlyingSeg) {
  return safeCall(() => client.post('/optionchain/expirylist', {
    UnderlyingScrip: underlyingScrip,
    UnderlyingSeg: underlyingSeg
  }, { headers: headers() }));
}

// ---- Historical (for ATR / displacement / structure reference) ----
async function getIntraday(securityId, exchangeSegment, instrument, interval) {
  return safeCall(() => client.post('/charts/intraday', {
    securityId: String(securityId),
    exchangeSegment,
    instrument,
    interval: String(interval || 1)
  }, { headers: headers() }));
}

// ---- Token renewal — Dhan does NOT support silent TOTP login like Angel One.
// This keeps a manually-generated token alive so you never have to regenerate daily.
async function renewToken() {
  return safeCall(() => client.post('/RenewToken', {}, { headers: headers() }));
}

module.exports = {
  getQuote, getLtp, getOhlc,
  getOptionChain, getExpiryList,
  getIntraday, renewToken,
  authStatus
};
