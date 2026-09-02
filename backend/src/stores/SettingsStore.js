import { config } from '../config/index.js';

// Deep-clone helper (structuredClone is available on Node >=17, which
// matches the "engines": {"node": ">=18"} constraint from the sample).
const clone = (o) => structuredClone(o);

export class SettingsStore {
  constructor() {
    this.bySymbol = new Map(); // symbol -> settings object
  }

  get(symbol) {
    if (!this.bySymbol.has(symbol)) {
      this.bySymbol.set(symbol, clone(config.strategyDefaults));
    }
    return this.bySymbol.get(symbol);
  }

  update(symbol, patch) {
    const current = this.get(symbol);
    const merged = {
      ...current,
      ...patch,
      style: { ...current.style, ...(patch.style || {}) },
    };
    this.bySymbol.set(symbol, merged);
    return merged;
  }

  all() {
    return Object.fromEntries(this.bySymbol.entries());
  }
}
