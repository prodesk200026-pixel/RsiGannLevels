// ============================================================
// instruments.js — resolves underlying / futures / expiry / strike / CE-PE
// to Dhan Security IDs using Dhan's OWN published instrument master.
//
// WHY: The spec says "do not hard-code incorrect Security IDs." Index/strike
// security IDs are NOT stable enough to hand-type reliably, and get it wrong
// silently and everything downstream (quotes, option chain) breaks. So this
// module downloads Dhan's official scrip master CSV once a day and resolves
// everything by NAME instead of by guessed numbers.
// ============================================================

const axios = require('axios');

// Dhan's publicly documented compact scrip master (refreshed by Dhan daily)
const SCRIP_MASTER_URL = 'https://images.dhan.co/api-data/api-scrip-master.csv';

let cache = { rows: [], loadedAt: 0 };
const ONE_DAY = 24 * 60 * 60 * 1000;

function parseCsv(text) {
  const lines = text.split('\n').filter(Boolean);
  const headers = lines[0].split(',').map(h => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    // scrip master fields can contain commas inside quotes in some columns; simple split
    // is sufficient for the columns we actually read (symbol/segment/instrument/strike/expiry).
    const parts = lines[i].split(',');
    if (parts.length < headers.length - 2) continue;
    const row = {};
    headers.forEach((h, idx) => { row[h] = (parts[idx] || '').trim(); });
    rows.push(row);
  }
  return rows;
}

async function ensureLoaded() {
  if (cache.rows.length && (Date.now() - cache.loadedAt) < ONE_DAY) return cache;
  try {
    const res = await axios.get(SCRIP_MASTER_URL, { timeout: 20000 });
    cache = { rows: parseCsv(res.data), loadedAt: Date.now() };
  } catch (err) {
    // Keep serving stale cache rather than crashing the whole backend
    console.error('[instruments] failed to refresh scrip master:', err.message);
  }
  return cache;
}

// Underlying index security IDs — resolved dynamically, NOT hardcoded.
async function resolveIndex(underlying) {
  const { rows } = await ensureLoaded();
  const name = underlying.toUpperCase();
  const wanted = name === 'NIFTY' ? 'NIFTY 50'
    : name === 'BANKNIFTY' ? 'NIFTY BANK'
    : name === 'SENSEX' ? 'SENSEX'
    : name;
  const row = rows.find(r =>
    (r.SEM_CUSTOM_SYMBOL || r.SM_SYMBOL_NAME || r.SYMBOL_NAME || '').toUpperCase() === wanted &&
    (r.SEM_EXM_EXCH_ID || r.EXCH_ID || '').toUpperCase().includes(name === 'SENSEX' ? 'BSE' : 'NSE')
  );
  if (!row) return null;
  return {
    securityId: row.SEM_SMST_SECURITY_ID || row.SECURITY_ID,
    exchangeSegment: name === 'SENSEX' ? 'IDX_I' : 'IDX_I',
    symbol: wanted
  };
}

// Full option chain instrument rows for an underlying + expiry (for cross-checking
// Dhan's own optionchain API response against the scrip master when needed).
async function findOptionRow(underlying, expiry, strike, optType) {
  const { rows } = await ensureLoaded();
  const name = underlying.toUpperCase();
  return rows.find(r => {
    const sym = (r.SEM_TRADING_SYMBOL || r.SYMBOL_NAME || '').toUpperCase();
    return sym.includes(name) &&
      sym.includes(String(strike)) &&
      sym.endsWith(optType.toUpperCase()) &&
      (r.SEM_EXPIRY_DATE || r.EXPIRY_DATE || '').startsWith(expiry);
  }) || null;
}

async function listExpiries(underlying) {
  const { rows } = await ensureLoaded();
  const name = underlying.toUpperCase();
  const set = new Set();
  rows.forEach(r => {
    const sym = (r.SEM_TRADING_SYMBOL || r.SYMBOL_NAME || '').toUpperCase();
    const exp = r.SEM_EXPIRY_DATE || r.EXPIRY_DATE;
    if (sym.includes(name) && exp) set.add(exp);
  });
  return Array.from(set).sort();
}

module.exports = { ensureLoaded, resolveIndex, findOptionRow, listExpiries };
