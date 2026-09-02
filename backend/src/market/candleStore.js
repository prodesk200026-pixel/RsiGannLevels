const TIMEFRAME_MS = {
  '1m': 60_000,
  '3m': 180_000,
  '5m': 300_000,
  '15m': 900_000,
};

export class CandleStore {
  static supportedTimeframes = Object.keys(TIMEFRAME_MS);

  constructor() {
    // symbol -> timeframe -> array of candles (last one may still be open)
    this.candles = new Map();
    this.listeners = []; // (symbol, timeframe, candle, isClosed) => void
  }

  onClose(fn) {
    this.listeners.push(fn);
  }

  getCandles(symbol, timeframe, limit = 100) {
    const arr = this.candles.get(symbol)?.get(timeframe) || [];
    return arr.slice(-limit);
  }

  onTick(symbol, quote) {
    if (!this.candles.has(symbol)) this.candles.set(symbol, new Map());
    const bySymbol = this.candles.get(symbol);

    for (const timeframe of Object.keys(TIMEFRAME_MS)) {
      if (!bySymbol.has(timeframe)) bySymbol.set(timeframe, []);
      const arr = bySymbol.get(timeframe);
      const bucketMs = TIMEFRAME_MS[timeframe];
      const bucketStart = Math.floor(quote.timestamp / bucketMs) * bucketMs;

      const last = arr[arr.length - 1];
      if (!last || last.time !== bucketStart) {
        if (last) {
          last.isClosed = true;
          this.listeners.forEach((fn) => fn(symbol, timeframe, last, true));
        }
        arr.push({
          time: bucketStart,
          open: quote.ltp,
          high: quote.ltp,
          low: quote.ltp,
          close: quote.ltp,
          volume: quote.volume || 0,
          isClosed: false,
        });
        if (arr.length > 2000) arr.shift();
      } else {
        last.high = Math.max(last.high, quote.ltp);
        last.low = Math.min(last.low, quote.ltp);
        last.close = quote.ltp;
        last.volume += quote.volume || 0;
      }
    }
  }
}
