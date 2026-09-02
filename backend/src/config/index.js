import 'dotenv/config';

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  port: num(process.env.PORT, 10000),
  frontendOrigin: process.env.FRONTEND_ORIGIN || '*',
  dataMode: process.env.DATA_MODE || 'MOCK', // LIVE | MOCK | REPLAY
  primaryBroker: process.env.PRIMARY_BROKER || 'DHAN',
  secondaryBroker: process.env.SECONDARY_BROKER || 'ANGEL',

  dhan: {
    clientId: process.env.DHAN_CLIENT_ID || '',
    accessToken: process.env.DHAN_ACCESS_TOKEN || '',
    restBase: 'https://api.dhan.co/v2',
    feedWsUrl: 'wss://api-feed.dhan.co',
  },

  angel: {
    apiKey: process.env.ANGEL_API_KEY || '',
    clientCode: process.env.ANGEL_CLIENT_CODE || '',
    pin: process.env.ANGEL_PIN || '',
    totpSecret: process.env.ANGEL_TOTP_SECRET || '',
    restBase: 'https://apiconnect.angelone.in',
    wsUrl: 'wss://smartapisocket.angelone.in/smart-stream',
  },

  push: {
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY || '',
    vapidPrivateKey: process.env.VAPID_PRIVATE_KEY || '',
    vapidSubject: process.env.VAPID_SUBJECT || 'mailto:alerts@example.com',
  },

  underlyings: (process.env.UNDERLYINGS || 'NIFTY').split(',').map((s) => s.trim()),

  // Strategy defaults — every one of these is also changeable per-symbol
  // at runtime from the frontend Settings panel (POST /api/settings).
  strategyDefaults: {
    rsiLength: num(process.env.RSI_LENGTH, 5),
    rsiMidline: num(process.env.RSI_MIDLINE, 50),
    smoothingLength: num(process.env.RSI_SMOOTHING_LENGTH, 14),
    smoothingType: process.env.RSI_SMOOTHING_TYPE || 'EMA', // EMA | SMA | RMA
    pullbackMaxPoints: num(process.env.PULLBACK_MAX_POINTS, 15),
    doubleEmaFast: num(process.env.DOUBLE_EMA_FAST, 9),
    doubleEmaSlow: num(process.env.DOUBLE_EMA_SLOW, 21),
    gannRatios: (process.env.GANN_RATIOS || '0,0.25,0.5,0.75,1,1.25,1.5,1.75,2,2.25,2.5,2.75,3')
      .split(',').map(Number),
    strikePremiumMin: num(process.env.STRIKE_PREMIUM_MIN, 5),
    strikePremiumMax: num(process.env.STRIKE_PREMIUM_MAX, 30),
    style: {
      rsiColor: '#8b5cf6',
      smoothedMaColor: '#3b82f6',
      upperLimitColor: '#9ca3af',
      middleLimitColor: '#ef4444',
      lowerLimitColor: '#9ca3af',
      gannColors: ['#3b82f6', '#111827', '#22c55e', '#111827', '#ef4444'],
      lineWidth: 2,
      greenDotColor: '#22c55e',
      redDotColor: '#ef4444',
    },
  },

  ringBuffers: {
    '1s': num(process.env.RING_BUFFER_1S, 120),
    '5s': num(process.env.RING_BUFFER_5S, 180),
    '15s': num(process.env.RING_BUFFER_15S, 240),
    '30s': num(process.env.RING_BUFFER_30S, 240),
    '60s': num(process.env.RING_BUFFER_60S, 300),
    '5m': num(process.env.RING_BUFFER_5M, 300),
  },
};
