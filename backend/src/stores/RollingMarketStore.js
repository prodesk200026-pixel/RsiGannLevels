import { config } from '../config/index.js';

class SymbolRing {
  constructor() {
    this.quotes = [];
    this.depths = [];
    this.optionSnapshots = [];
    this.maxQuotes = config.ringBuffers['1s'] * 5; // generous flat buffer; candleStore does the real bucketing
    this.maxOptionSnapshots = 50;
  }

  pushQuote(q) {
    this.quotes.push(q);
    if (this.quotes.length > this.maxQuotes) this.quotes.shift();
  }

  pushDepth(d) {
    this.depths.push(d);
    if (this.depths.length > 200) this.depths.shift();
  }

  pushOptionSnapshot(s) {
    this.optionSnapshots.push(s);
    if (this.optionSnapshots.length > this.maxOptionSnapshots) this.optionSnapshots.shift();
  }

  latestQuote() {
    return this.quotes[this.quotes.length - 1] || null;
  }

  latestOptionSnapshot() {
    return this.optionSnapshots[this.optionSnapshots.length - 1] || null;
  }
}

export class RollingMarketStore {
  constructor() {
    this.bySymbol = new Map();
  }

  forSymbol(symbol) {
    if (!this.bySymbol.has(symbol)) this.bySymbol.set(symbol, new SymbolRing());
    return this.bySymbol.get(symbol);
  }
}
