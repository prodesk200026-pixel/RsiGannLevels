import { config } from '../config/index.js';
import { DhanAdapter } from './DhanAdapter.js';
import { AngelOneAdapter } from './AngelOneAdapter.js';
import { MockAdapter } from './MockAdapter.js';

function build(name) {
  if (name === 'DHAN') return new DhanAdapter();
  if (name === 'ANGEL') return new AngelOneAdapter();
  return new MockAdapter();
}

export class AdapterManager {
  constructor() {
    this.quoteListeners = [];
    this.depthListeners = [];
    this.active = null; // the adapter actually in use
    this.activeName = null;
  }

  onQuote(fn) { this.quoteListeners.push(fn); }
  onDepth(fn) { this.depthListeners.push(fn); }

  async start() {
    if (config.dataMode === 'MOCK') {
      this.active = new MockAdapter();
      this.activeName = 'MOCK';
    } else {
      const primary = build(config.primaryBroker);
      try {
        await primary.start();
        this.active = primary;
        this.activeName = config.primaryBroker;
      } catch (err) {
        console.warn(`[AdapterManager] primary broker ${config.primaryBroker} failed to start: ${err.message}`);
        const secondary = build(config.secondaryBroker);
        try {
          await secondary.start();
          this.active = secondary;
          this.activeName = config.secondaryBroker;
        } catch (err2) {
          console.warn(`[AdapterManager] secondary broker ${config.secondaryBroker} also failed: ${err2.message}. Falling back to MOCK.`);
          this.active = new MockAdapter();
          this.activeName = 'MOCK';
        }
      }
    }

    this.active.on('quote', (quote, provider) => {
      if (this.active.setSpotHint) this.active.setSpotHint(quote.symbol, quote.ltp);
      this.quoteListeners.forEach((fn) => fn(quote, provider ?? this.activeName));
    });
    this.active.on('depth', (depth, provider) => {
      this.depthListeners.forEach((fn) => fn(depth, provider ?? this.activeName));
    });
    this.active.on('error', (e) => console.warn('[AdapterManager] adapter error:', e));
  }

  async subscribe(instruments) {
    return this.active.subscribe(instruments);
  }

  async subscribeDepth(instruments, levels) {
    return this.active.subscribeDepth(instruments, levels);
  }

  async getOptionChain(symbol, expiryMode) {
    return this.active.getOptionChain(symbol, expiryMode);
  }

  status() {
    return { activeProvider: this.activeName, dataMode: config.dataMode };
  }
}
