import { EventEmitter } from 'events';
import axios from 'axios';
import { config } from '../config/index.js';

/**
 * Dhan v2 REST adapter.
 *
 * NOTE ON SCOPE: Dhan also offers a binary WebSocket market feed
 * (wss://api-feed.dhan.co) which is lower-latency than polling. That
 * protocol uses fixed-width binary packets that are easy to get
 * subtly wrong without a live connection to test against — since
 * this environment has no network access to verify framing, this
 * adapter intentionally uses REST polling (1s quotes, matching the
 * 1-second candle bucket) so what ships here is correct and testable
 * against Dhan's documented JSON responses. Swapping in the WS feed
 * later is a drop-in replacement: keep emitting the same 'quote'
 * shape and nothing downstream needs to change.
 *
 * Docs to check before going live (endpoints/fields do change):
 *   https://dhanhq.co/docs/v2/
 */
export class DhanAdapter extends EventEmitter {
  constructor() {
    super();
    this.client = axios.create({
      baseURL: config.dhan.restBase,
      headers: {
        'access-token': config.dhan.accessToken,
        'client-id': config.dhan.clientId,
        'Content-Type': 'application/json',
      },
      timeout: 8000,
    });
    this.instruments = [];
    this.pollTimer = null;
  }

  async start() {
    if (!config.dhan.accessToken || !config.dhan.clientId) {
      throw new Error('DHAN_CLIENT_ID / DHAN_ACCESS_TOKEN not set');
    }
  }

  async subscribe(instruments) {
    this.instruments = instruments;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => this.#pollQuotes(), 1000);
  }

  async subscribeDepth() {
    // 20-level depth requires the WS feed; not implemented in the
    // REST-polling version. Downstream code treats missing depth as
    // "unavailable" rather than failing.
  }

  async #pollQuotes() {
    for (const inst of this.instruments) {
      try {
        // POST /v2/marketfeed/ltp  { NSE_FNO: [securityId], IDX_I: [securityId], ... }
        const segment = inst.exchangeSegment || 'IDX_I';
        const securityId = inst.dhanSecurityId || inst.angelSymbolToken; // fill in real Dhan securityId per instrument master
        const { data } = await this.client.post('/marketfeed/ltp', {
          [segment]: [Number(securityId)],
        });
        const ltp = data?.data?.[segment]?.[securityId]?.last_price;
        if (ltp != null) {
          this.emit('quote', { symbol: inst.symbol, ltp, volume: 0, timestamp: Date.now() }, 'DHAN');
        }
      } catch (err) {
        this.emit('error', { provider: 'DHAN', symbol: inst.symbol, message: err.message });
      }
    }
  }

  async getOptionChain(symbol, expiryMode = 'NEAREST_WEEKLY') {
    // Dhan requires UnderlyingScrip (security id of the index) + segment + expiry date string.
    // 1) fetch expiry list, 2) pick nearest, 3) fetch chain for that expiry.
    const underlyingScrip = this.#underlyingScrip(symbol);
    const { data: expiryData } = await this.client.post('/optionchain/expirylist', {
      UnderlyingScrip: underlyingScrip,
      UnderlyingSeg: 'IDX_I',
    });
    const expiries = expiryData?.data || [];
    if (!expiries.length) return null;
    const expiry = expiryMode === 'NEAREST_WEEKLY' ? expiries[0] : expiries[expiries.length - 1];

    const { data: chainData } = await this.client.post('/optionchain', {
      UnderlyingScrip: underlyingScrip,
      UnderlyingSeg: 'IDX_I',
      Expiry: expiry,
    });

    const payload = chainData?.data;
    if (!payload) return null;

    const spot = payload.last_price;
    const rows = Object.entries(payload.oc || {}).map(([strike, row]) => ({
      strike: Number(strike),
      ce: row.ce && {
        ltp: row.ce.last_price,
        oi: row.ce.oi,
        volume: row.ce.volume,
        iv: row.ce.implied_volatility,
      },
      pe: row.pe && {
        ltp: row.pe.last_price,
        oi: row.pe.oi,
        volume: row.pe.volume,
        iv: row.pe.implied_volatility,
      },
    }));

    const timeToExpiryYears = Math.max((new Date(expiry) - new Date()) / (365 * 24 * 3600 * 1000), 0.0005);
    return { symbol, spot, expiry, timeToExpiryYears, rows };
  }

  #underlyingScrip(symbol) {
    // Dhan's well-known index security IDs — verify against the current
    // instrument master (api-scrip-master.csv) before relying on these.
    const map = { NIFTY: 13, BANKNIFTY: 25, SENSEX: 51 };
    return map[symbol] ?? 13;
  }

  stop() {
    if (this.pollTimer) clearInterval(this.pollTimer);
  }
}
