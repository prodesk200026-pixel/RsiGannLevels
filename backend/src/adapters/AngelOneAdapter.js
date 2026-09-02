import { EventEmitter } from 'events';
import axios from 'axios';
import { authenticator } from 'otplib';
import { config } from '../config/index.js';

const SCRIP_MASTER_URL =
  'https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json';

/**
 * Angel One SmartAPI adapter (REST polling — see the note in
 * DhanAdapter.js about why WS binary streaming isn't attempted here
 * without a live connection to verify against).
 *
 * Angel has no single "option chain" endpoint like Dhan, so the
 * chain is assembled by: fetch the instrument master once (cached),
 * filter to this underlying's option contracts for the chosen
 * expiry within N strikes of spot, then batch-quote those tokens.
 *
 * Docs to check before going live:
 *   https://smartapi.angelbroking.com/docs
 */
export class AngelOneAdapter extends EventEmitter {
  constructor() {
    super();
    this.client = axios.create({
      baseURL: config.angel.restBase,
      timeout: 8000,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-UserType': 'USER',
        'X-SourceID': 'WEB',
        'X-ClientLocalIP': '127.0.0.1',
        'X-ClientPublicIP': '127.0.0.1',
        'X-MACAddress': '00:00:00:00:00:00',
        'X-PrivateKey': config.angel.apiKey,
      },
    });
    this.jwtToken = null;
    this.scripMaster = null;
    this.instruments = [];
    this.pollTimer = null;
  }

  async start() {
    const { apiKey, clientCode, pin, totpSecret } = config.angel;
    if (!apiKey || !clientCode || !pin || !totpSecret) {
      throw new Error('ANGEL_API_KEY / ANGEL_CLIENT_CODE / ANGEL_PIN / ANGEL_TOTP_SECRET not set');
    }
    const totp = authenticator.generate(totpSecret);
    const { data } = await this.client.post('/rest/auth/angelbroking/user/v1/loginByPassword', {
      clientcode: clientCode,
      password: pin,
      totp,
    });
    if (!data?.data?.jwtToken) {
      throw new Error(`Angel One login failed: ${data?.message || 'unknown error'}`);
    }
    this.jwtToken = data.data.jwtToken;
    this.client.defaults.headers.Authorization = `Bearer ${this.jwtToken}`;
  }

  async #loadScripMaster() {
    if (this.scripMaster) return this.scripMaster;
    const { data } = await axios.get(SCRIP_MASTER_URL, { timeout: 20000 });
    this.scripMaster = data; // large array of { token, symbol, name, expiry, strike, instrumenttype, exch_seg, lotsize }
    return this.scripMaster;
  }

  async subscribe(instruments) {
    this.instruments = instruments;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => this.#pollQuotes(), 1000);
  }

  async subscribeDepth() {
    // 20-level depth needs the WS feed; treated as unavailable here.
  }

  async #pollQuotes() {
    for (const inst of this.instruments) {
      try {
        const { data } = await this.client.post('/rest/secure/angelbroking/market/v1/quote', {
          mode: 'LTP',
          exchangeTokens: { [inst.angelExchange]: [inst.angelSymbolToken] },
        });
        const row = data?.data?.fetched?.[0];
        if (row?.ltp != null) {
          this.emit('quote', { symbol: inst.symbol, ltp: row.ltp, volume: 0, timestamp: Date.now() }, 'ANGEL');
        }
      } catch (err) {
        this.emit('error', { provider: 'ANGEL', symbol: inst.symbol, message: err.message });
      }
    }
  }

  async getOptionChain(symbol) {
    const master = await this.#loadScripMaster();
    const options = master.filter(
      (row) => row.name === symbol && row.instrumenttype === 'OPTIDX'
    );
    if (!options.length) return null;

    const expiries = [...new Set(options.map((o) => o.expiry))].sort(
      (a, b) => new Date(a) - new Date(b)
    );
    const expiry = expiries[0];
    const nearExpiry = options.filter((o) => o.expiry === expiry);

    const spotQuote = this.#lastSpot(symbol);
    const step = symbol === 'BANKNIFTY' ? 100 : 50;
    const atm = spotQuote ? Math.round(spotQuote / step) * step : null;
    const nearStrikes = atm
      ? nearExpiry.filter((o) => Math.abs(Number(o.strike) / 100 - atm) <= step * 8)
      : nearExpiry;

    const tokensBySeg = {};
    for (const o of nearStrikes) {
      (tokensBySeg[o.exch_seg] ??= []).push(o.token);
    }

    const { data } = await this.client.post('/rest/secure/angelbroking/market/v1/quote', {
      mode: 'FULL',
      exchangeTokens: tokensBySeg,
    });
    const quotes = data?.data?.fetched || [];
    const byToken = new Map(quotes.map((q) => [q.symbolToken, q]));

    const rowsByStrike = new Map();
    for (const o of nearStrikes) {
      const strike = Number(o.strike) / 100;
      const q = byToken.get(o.token);
      if (!rowsByStrike.has(strike)) rowsByStrike.set(strike, { strike });
      const side = o.symbol.endsWith('CE') ? 'ce' : 'pe';
      rowsByStrike.get(strike)[side] = q && {
        ltp: q.ltp,
        oi: q.opnInterest,
        volume: q.tradeVolume,
        iv: q.impliedVolatility ?? null, // Angel's FULL quote may not always include IV — falls back to null, engine treats as unavailable
      };
    }

    const timeToExpiryYears = Math.max((new Date(expiry) - new Date()) / (365 * 24 * 3600 * 1000), 0.0005);
    return {
      symbol,
      spot: spotQuote,
      expiry,
      timeToExpiryYears,
      rows: [...rowsByStrike.values()].sort((a, b) => a.strike - b.strike),
    };
  }

  #lastSpot(symbol) {
    // Filled in by AdapterManager via setSpotHint() so the chain
    // builder knows roughly where ATM is without a second round trip.
    return this._spotHints?.[symbol] ?? null;
  }

  setSpotHint(symbol, price) {
    this._spotHints ??= {};
    this._spotHints[symbol] = price;
  }

  stop() {
    if (this.pollTimer) clearInterval(this.pollTimer);
  }
}
