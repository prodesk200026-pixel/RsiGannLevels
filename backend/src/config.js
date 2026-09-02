// ============================================================
// GAMMA X UNIFIED BACKEND — config.js
// All tunable numbers live here so you never have to touch engine code
// to adjust sensitivity. Change a value, redeploy, done.
// ============================================================

require('dotenv').config();

module.exports = {
  // ---------------- Server ----------------
  PORT: process.env.PORT || 10000,
  CORS_ORIGINS: (process.env.CORS_ORIGINS || '*').split(',').map(s => s.trim()),
  LOG_LEVEL: process.env.LOG_LEVEL || 'INFO',

  // ---------------- Dhan credentials (backend only, never sent to frontend) ----------------
  DHAN: {
    CLIENT_ID: process.env.DHAN_CLIENT_ID || '',
    ACCESS_TOKEN: process.env.DHAN_ACCESS_TOKEN || '', // manually generated once, valid 24h — auto-renewed by tokenRenewer.js
    BASE_URL: 'https://api.dhan.co/v2',
    // Dhan has NO TOTP / silent-login flow like Angel One. This is the one important
    // difference: we cannot generate a brand-new token without you logging into the
    // Dhan web console at least once. What we CAN do is keep a generated token alive
    // indefinitely using /v2/RenewToken, called automatically every RENEW_INTERVAL_HOURS.
    RENEW_INTERVAL_HOURS: 20
  },

  // ---------------- Angel One (kept for endpoints that still use it, e.g. Wall Sniper compat) ----------------
  ANGEL: {
    API_KEY: process.env.API_KEY || '',
    CLIENT_CODE: process.env.CLIENT_CODE || '',
    PIN: process.env.PIN || '',
    TOTP_SECRET: process.env.TOTP_SECRET || ''
  },

  // ---------------- Deep depth instrument (200-level, one instrument per connection) ----------------
  DEEP_DEPTH_SYMBOL: process.env.DEEP_DEPTH_SYMBOL || 'BANKNIFTY_FUT',

  // ---------------- Polling intervals (ms) ----------------
  // NOTE: This build uses Dhan's REST batch Quote/OptionChain endpoints on a fast poll
  // loop rather than the raw WebSocket binary feed. Reason: the binary tick/depth
  // protocol needs byte-level testing against a *live* funded account to get right,
  // which I cannot do myself, and a wrong parser silently returns garbage numbers —
  // worse than a slightly slower REST poll. Quote/LTP is polled every 2s (well inside
  // Dhan's documented limits), option chain every 5s per the doc's own guidance.
  POLL: {
    QUOTE_MS: 2000,
    OPTION_CHAIN_MS: 5000,
    RENEW_CHECK_MS: 30 * 60 * 1000 // check token age every 30 min
  },

  // ---------------- Rolling windows (ms) for order-flow engine ----------------
  WINDOWS_MS: [1000, 3000, 5000, 15000, 30000, 60000],

  // ---------------- Impulse score weights (must sum to 100) ----------------
  IMPULSE_WEIGHTS: {
    directionalFlow: 20,
    volumeAcceleration: 15,
    bidAskImbalance: 15,
    liquidityConsumption: 15,
    priceDisplacement: 15,
    structureBreak: 10,
    followThrough: 5,
    tickVelocity: 5
  },

  // ---------------- Signal classification bands ----------------
  SCORE_BANDS: [
    { max: 39, state: 'NO_TRADE', label: 'NO TRADE' },
    { max: 54, state: 'WEAK_PRESSURE', label: 'WEAK PRESSURE' },
    { max: 64, state: 'WATCH', label: 'WATCH' },
    { max: 79, state: 'STRONG_IMPULSE', label: 'STRONG IMPULSE' },
    { max: 89, state: 'HIGH_CONVICTION', label: 'HIGH-CONVICTION IMPULSE' },
    { max: 100, state: 'EXTREME_IMPULSE', label: 'EXTREME IMPULSE' }
  ],

  // ---------------- Displacement thresholds (x ATR) ----------------
  DISPLACEMENT: { weak: 0.50, moderate: 0.80, strong: 1.20 },

  // ---------------- Noise filter ----------------
  MIN_CONFIRMATIONS: 4, // out of the 6 independent conditions checked in order_flow_engine.js

  // ---------------- Fixed exit plan (same rule used across all your terminals) ----------------
  EXIT_PLAN: {
    stopLossPct: -35,      // exit if premium drops 35% from entry, no hesitation
    bookHalfAtMultiple: 2, // book half the position at 2x premium
    trailGivebackPct: 30   // trail rest, exit remaining if it gives back 30% from peak
  },

  // ---------------- Alert cooldown (ms) to prevent spam ----------------
  ALERT_COOLDOWN_MS: 90 * 1000,

  // ---------------- Supported underlyings ----------------
  UNDERLYINGS: ['NIFTY', 'BANKNIFTY', 'SENSEX'],

  // ---------------- VAPID (web push) ----------------
  VAPID: {
    PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY || '',
    PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY || '',
    SUBJECT: process.env.VAPID_SUBJECT || 'mailto:gexblast@example.com'
  }
};
