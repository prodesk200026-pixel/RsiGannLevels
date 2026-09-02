'use strict';
const axios = require('axios');

class DhanBroker {
  constructor(cfg) {
    this.cfg = cfg.broker.dhan;
    this.client = axios.create({
      baseURL: this.cfg.baseUrl,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'access-token': this.cfg.accessToken,
        'client-id': this.cfg.clientId,
      },
      timeout: 10000,
    });
  }

  isConfigured() {
    return !!(this.cfg.accessToken && this.cfg.clientId);
  }

  /** interval: '1' | '5' | '15' | '25' | '60' (minutes) */
  async getIntradayCandles(securityId, exchangeSegment, interval, fromDate, toDate) {
    const { data } = await this.client.post('/v2/charts/intraday', {
      securityId: String(securityId),
      exchangeSegment,
      instrument: 'INDEX',
      interval: String(interval),
      oi: false,
      fromDate,
      toDate,
    });
    // Response: { open:[], high:[], low:[], close:[], volume:[], timestamp:[] }
    if (!data || !Array.isArray(data.open)) return [];
    const out = [];
    for (let i = 0; i < data.open.length; i++) {
      out.push({
        t: data.timestamp[i] * 1000,
        o: data.open[i], h: data.high[i], l: data.low[i], c: data.close[i],
      });
    }
    return out;
  }

  async getExpiryList(underlyingScrip, underlyingSeg) {
    const { data } = await this.client.post('/v2/optionchain/expirylist', {
      UnderlyingScrip: Number(underlyingScrip),
      UnderlyingSeg: underlyingSeg,
    });
    return data && data.data ? data.data : [];
  }

  /** Returns { last_price, oc: { "<strike>": { ce:{...}, pe:{...} } } } per Dhan's schema */
  async getOptionChain(underlyingScrip, underlyingSeg, expiry) {
    const { data } = await this.client.post('/v2/optionchain', {
      UnderlyingScrip: Number(underlyingScrip),
      UnderlyingSeg: underlyingSeg,
      Expiry: expiry,
    });
    return data && data.data ? data.data : null;
  }

  /** Picks the ATM strike, returns { strike, ce, pe, straddlePrice, atmIv } */
  static extractAtm(optionChainData, strikeStep) {
    if (!optionChainData || !optionChainData.oc) return null;
    const underlyingPrice = optionChainData.last_price;
    const strikes = Object.keys(optionChainData.oc).map(Number).sort((a, b) => a - b);
    if (!strikes.length) return null;
    let atmStrike = strikes.reduce((best, s) => Math.abs(s - underlyingPrice) < Math.abs(best - underlyingPrice) ? s : best, strikes[0]);
    const row = optionChainData.oc[String(atmStrike)] || optionChainData.oc[atmStrike];
    if (!row) return null;
    const ce = row.ce || {};
    const pe = row.pe || {};
    const straddlePrice = (ce.last_price || 0) + (pe.last_price || 0);
    const atmIv = ((ce.implied_volatility || 0) + (pe.implied_volatility || 0)) / 2;
    return { strike: atmStrike, underlyingPrice, ce, pe, straddlePrice, atmIv };
  }

  /** Find the nearest strike (CE or PE) whose premium falls inside [min,max]. */
  static findStrikeInPremiumRange(optionChainData, side /* 'ce'|'pe' */, min, max) {
    if (!optionChainData || !optionChainData.oc) return null;
    const rows = Object.entries(optionChainData.oc)
      .map(([strike, row]) => ({ strike: Number(strike), leg: row[side] }))
      .filter(r => r.leg && typeof r.leg.last_price === 'number');
    const inRange = rows.filter(r => r.leg.last_price >= min && r.leg.last_price <= max);
    if (!inRange.length) return null;
    // prefer the one closest to the midpoint of the desired range
    const mid = (min + max) / 2;
    inRange.sort((a, b) => Math.abs(a.leg.last_price - mid) - Math.abs(b.leg.last_price - mid));
    return inRange[0];
  }
}

module.exports = { DhanBroker };
