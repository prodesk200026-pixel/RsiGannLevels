import express from 'express';
import cors from 'cors';
import { createServer } from 'http';

import { config } from './src/config/index.js';
import { AdapterManager } from './src/adapters/AdapterManager.js';
import { RollingMarketStore } from './src/stores/RollingMarketStore.js';
import { SettingsStore } from './src/stores/SettingsStore.js';
import { CandleStore } from './src/market/candleStore.js';
import { Pipeline } from './src/engine/pipeline.js';
import { PushService } from './src/alerts/pushService.js';
import { AlertManager } from './src/alerts/alertManager.js';
import { attachSocket } from './src/socket/index.js';
import { apiRouter } from './src/routes/api.js';
import { resolveMicrostructureInstrument, listUnderlyings } from './src/data/instrumentResolver.js';

/**
 * SIGNAL-ONLY APPLICATION.
 * This server does not, and must never, place, modify, or cancel
 * orders. There is no order-placement route, no broker order API
 * call, and no code path that executes a trade. All output — the
 * BUY CALL / BUY PUT cards, the ATM cross alerts — is read-only
 * market intelligence for a human to act on manually, at their own
 * discretion and risk. Options trading carries substantial risk of
 * loss; nothing here is financial advice.
 */

const app = express();
app.use(cors({ origin: config.frontendOrigin }));
app.use(express.json());

app.get('/', (req, res) => {
  res.json({
    service: 'NIFTY Signal Engine backend',
    status: 'ok',
    dataMode: config.dataMode,
    hint: 'Health check is at /api/health.',
  });
});

const rollingStore = new RollingMarketStore();
const settingsStore = new SettingsStore();
const adapterManager = new AdapterManager();
const candleStore = new CandleStore();

const httpServer = createServer(app);
const io = attachSocket(httpServer);

const pushService = new PushService();
const alertManager = new AlertManager({ pushService, io });
const pipeline = new Pipeline({ settingsStore, alertManager, io });

app.use('/api', apiRouter({ adapterManager, settingsStore, pushService, alertManager }));

app.get('/api/candles', (req, res) => {
  const { symbol, timeframe = '1m', limit = 200 } = req.query;
  if (!symbol) return res.status(400).json({ error: 'symbol query param required' });
  if (!CandleStore.supportedTimeframes.includes(timeframe)) {
    return res.status(400).json({ error: `unsupported timeframe. use one of: ${CandleStore.supportedTimeframes.join(', ')}` });
  }
  res.json({ symbol, timeframe, candles: candleStore.getCandles(symbol, timeframe, Number(limit)) });
});

// Explicit guard: reject anything that looks like an order-placement
// request, in case a future contributor adds one by mistake.
app.all('/api/order*', (req, res) => {
  res.status(403).json({
    error: 'FORBIDDEN',
    message: 'This is a signal-only application. Order placement is not implemented and will not be added to this API.',
  });
});

candleStore.onClose((symbol, timeframe, candle) => pipeline.onCandleClose(symbol, timeframe, candle));

async function start() {
  await adapterManager.start();

  const trackedSymbols = listUnderlyings();
  const instruments = trackedSymbols.map((sym) => resolveMicrostructureInstrument(sym));

  adapterManager.onQuote((quote) => {
    const symbol = quote.symbol.replace('-FUT', '');
    rollingStore.forSymbol(symbol).pushQuote(quote);
    candleStore.onTick(symbol, quote);
    io.emit('quote', quote);
  });
  adapterManager.onDepth((depth) => {
    rollingStore.forSymbol(depth.symbol.replace('-FUT', '')).pushDepth(depth);
  });

  await adapterManager.subscribe(instruments);
  await adapterManager.subscribeDepth(instruments, 20);

  // Option chain poller — the entry-signal strike selection, Greeks,
  // OI/volume-shift analytics and the ATM IV/Straddle cross alarms
  // all run off this snapshot. REST-based since chains update far
  // less often than the tick stream.
  const OPTION_CHAIN_POLL_MS = 5000;
  setInterval(async () => {
    for (const symbol of trackedSymbols) {
      try {
        const chain = await adapterManager.getOptionChain(symbol, 'NEAREST_WEEKLY');
        if (chain) {
          rollingStore.forSymbol(symbol).pushOptionSnapshot(chain);
          pipeline.onOptionSnapshot(symbol, chain);
        }
      } catch (err) {
        console.warn(`[optionChainPoll] ${symbol}:`, err.message);
      }
    }
  }, OPTION_CHAIN_POLL_MS);

  httpServer.listen(config.port, () => {
    console.log(`NIFTY Signal Engine backend listening on :${config.port}`);
    console.log(`DATA_MODE=${config.dataMode}  PRIMARY_BROKER=${config.primaryBroker}  SECONDARY_BROKER=${config.secondaryBroker}`);
  });
}

start().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
