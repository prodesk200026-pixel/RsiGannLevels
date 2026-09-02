require('dotenv').config();

// ------------------------------------------------------------------
// Dhan "securityId" for the index itself (IDX_I segment) — used for
// both the option-chain "UnderlyingScrip" param AND intraday candles.
// Verify against Dhan's daily scrip master before going live:
//   https://images.dhan.co/api-data/api-scrip-master.csv
// (search the row where SEM_TRADING_SYMBOL / SM_SYMBOL_NAME = the
// index name and SEM_EXM_EXCH_ID = IDX). The numbers below are the
// commonly published ones as of 2026 but Dhan can renumber, so treat
// this block as the single place you'd ever need to fix.
// ------------------------------------------------------------------
const DHAN_INDEX_MAP = {
  NIFTY:    { securityId: '13', segment: 'IDX_I', angelSymbol: 'NIFTY',    strikeStep: 50 },
  BANKNIFTY:{ securityId: '25', segment: 'IDX_I', angelSymbol: 'BANKNIFTY',strikeStep: 100 },
  SENSEX:   { securityId: '51', segment: 'IDX_I', angelSymbol: 'SENSEX',   strikeStep: 100 },
  FINNIFTY: { securityId: '27', segment: 'IDX_I', angelSymbol: 'FINNIFTY', strikeStep: 50 },
};

const TRACK_INDICES = (process.env.TRACK_INDICES || 'NIFTY,SENSEX,FINNIFTY')
  .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);

module.exports = {
  broker: {
    mode: (process.env.BROKER_MODE || 'both').toLowerCase(), // dhan | angelone | both
    dhan: {
      clientId: process.env.DHAN_CLIENT_ID || '',
      accessToken: process.env.DHAN_ACCESS_TOKEN || '',
      baseUrl: 'https://api.dhan.co',
    },
    angel: {
      apiKey: process.env.ANGEL_API_KEY || '',
      clientCode: process.env.ANGEL_CLIENT_CODE || '',
      password: process.env.ANGEL_PASSWORD || '',
      totpSecret: process.env.ANGEL_TOTP_SECRET || '',
      baseUrl: 'https://apiconnect.angelone.in',
    },
  },
  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY || '',
    privateKey: process.env.VAPID_PRIVATE_KEY || '',
    contact: process.env.VAPID_CONTACT_EMAIL || 'mailto:example@example.com',
  },
  server: {
    port: parseInt(process.env.PORT || '10000', 10),
    apiSecret: process.env.API_SECRET || 'change-me-please',
  },
  polling: {
    intervalSeconds: parseInt(process.env.POLL_INTERVAL_SECONDS || '15', 10),
    marketHoursOnly: (process.env.MARKET_HOURS_ONLY || 'true').toLowerCase() !== 'false',
  },
  trackIndices: TRACK_INDICES,
  indexMap: DHAN_INDEX_MAP,

  // ---------------- Strategy defaults (all overridable at runtime
  // via POST /api/config, per index+direction) ----------------
  defaultStrategyConfig: {
    rsiPeriod: 5,
    rsiEmaPeriod: 5,           // EMA applied ON the RSI line
    rsiMidLine: 50,
    pullbackMaxRange: 15,      // max (high-low) points allowed across the pullback candles
    pullbackMaxCandles: 6,     // give up waiting for pullback to resolve after N candles
    emaFastPeriod: 9,          // "double EMA" band, fast leg
    emaSlowPeriod: 21,         // "double EMA" band, slow leg
    gannStep: 0.25,            // low=0 .. high=0.25 unit definition
    gannMaxLevel: 3,           // extend targets up to 3.0
    candleTimeframeMinutes: 3, // candle size used for the whole strategy
    strikePremiumMin: 5,
    strikePremiumMax: 30,
    colors: {
      price: '#c9ccd6',
      emaFast: '#26a69a',
      emaSlow: '#ef5350',
      rsi: '#7e57c2',
      rsiEma: '#ffa726',
      gannLines: '#42a5f5',
      dotGreen: '#2ecc71',
      straddle: '#26c6da',
      iv: '#7c4dff',
    },
    lineWidths: {
      price: 1.5,
      emaFast: 2,
      emaSlow: 2,
      rsi: 1.5,
      rsiEma: 1.5,
      gannLines: 1,
    },
  },
};
