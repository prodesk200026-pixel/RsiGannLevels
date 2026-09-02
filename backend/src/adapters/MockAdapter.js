import { EventEmitter } from 'events';

/**
 * Generates a plausible-looking index tick stream and option chain so
 * you can run the full pipeline — engine, sockets, PWA, push alerts —
 * before wiring in real broker credentials. Switch DATA_MODE=LIVE and
 * fill in the Dhan/Angel env vars to go live; nothing else changes.
 */
export class MockAdapter extends EventEmitter {
  constructor() {
    super();
    this.spot = new Map(); // symbol -> current price
    this.timers = [];
  }

  async start() { /* no-op */ }

  async subscribe(instruments) {
    for (const inst of instruments) {
      const base = inst.symbol === 'BANKNIFTY' ? 51200 : inst.symbol === 'SENSEX' ? 79500 : 24055.8;
      this.spot.set(inst.symbol, base);
      const timer = setInterval(() => this.#tick(inst), 1000);
      this.timers.push(timer);
    }
  }

  async subscribeDepth() { /* mock: depth not modeled, quotes are enough to drive the engine */ }

  async getOptionChain(symbol) {
    const spot = this.spot.get(symbol) || 24055.8;
    const step = symbol === 'BANKNIFTY' || symbol === 'SENSEX' ? 100 : 50;
    const atmStrike = Math.round(spot / step) * step;
    const rows = [];
    for (let k = -6; k <= 6; k++) {
      const strike = atmStrike + k * step;
      const distance = Math.abs(strike - spot);
      const ceLtp = Math.max(1, (spot - strike) + 60 - distance * 0.08 + this.#noise(3));
      const peLtp = Math.max(1, (strike - spot) + 60 - distance * 0.08 + this.#noise(3));
      rows.push({
        strike,
        ce: {
          ltp: +ceLtp.toFixed(2),
          oi: Math.round(500000 + Math.random() * 2000000),
          volume: Math.round(10000 + Math.random() * 500000),
          iv: +(14 + Math.random() * 8).toFixed(2),
        },
        pe: {
          ltp: +peLtp.toFixed(2),
          oi: Math.round(500000 + Math.random() * 2000000),
          volume: Math.round(10000 + Math.random() * 500000),
          iv: +(14 + Math.random() * 8).toFixed(2),
        },
      });
    }
    const now = new Date();
    const nextThursday = new Date(now);
    nextThursday.setDate(now.getDate() + ((4 - now.getDay() + 7) % 7 || 7));
    const timeToExpiryYears = Math.max((nextThursday - now) / (365 * 24 * 3600 * 1000), 0.0005);

    return { symbol, spot, expiry: nextThursday.toISOString().slice(0, 10), timeToExpiryYears, rows };
  }

  #noise(scale) {
    return (Math.random() - 0.5) * 2 * scale;
  }

  #tick(inst) {
    const prev = this.spot.get(inst.symbol);
    const drift = (Math.random() - 0.5) * (inst.symbol === 'BANKNIFTY' ? 40 : 12);
    const next = +(prev + drift).toFixed(2);
    this.spot.set(inst.symbol, next);
    this.emit('quote', {
      symbol: inst.symbol,
      ltp: next,
      volume: Math.round(Math.random() * 5000),
      timestamp: Date.now(),
    }, 'MOCK');
  }

  stop() {
    this.timers.forEach(clearInterval);
  }
}
