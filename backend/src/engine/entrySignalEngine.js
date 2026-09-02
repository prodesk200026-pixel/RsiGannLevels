import { computeRsiWithSignal } from '../indicators/rsi.js';
import { ema, crossedAbove, crossedBelow } from '../indicators/movingAverages.js';
import { buildGannBox, reachedLevel } from '../indicators/gannBox.js';

/**
 * Implements, candle-by-candle, on the underlying INDEX series:
 *
 *  1. RSI(len) crosses its own smoothing line while below the midline
 *     (bullish flip) -> arms a CALL search. Mirror: crosses while
 *     above the midline (bearish flip) -> arms a PUT search.
 *  2. Next candle(s): look for a "pullback" candle whose (high-low)
 *     is <= pullbackMaxPoints.
 *  3. Build a Gann Box off that pullback candle (0 / 0.25 anchors,
 *     projected out to 3x).
 *  4. Double-EMA trend filter: for CALL, the pullback candle's
 *     high/close must stay above BOTH emaFast & emaSlow. Mirror for
 *     PUT: low/close must stay below both.
 *  5. The first subsequent candle that CLOSES back above (CALL) /
 *     below (PUT) the double-EMA gets a marker dot. The next candle
 *     after that whose close breaks the Gann 0.25 level in the trade
 *     direction is the actual ENTRY.
 *
 * One instance tracks ONE direction (CALL or PUT) for one symbol so
 * both directions can be armed independently and fire independently,
 * satisfying "must work for call or put ... use mirror logic".
 */
export class EntrySignalEngine {
  constructor(symbol, direction, settings) {
    this.symbol = symbol;
    this.direction = direction; // 'CALL' | 'PUT'
    this.settings = settings;
    this.candles = []; // {time, open, high, low, close}
    this.state = 'IDLE';
    this.pullback = null; // {candle, gannBox}
    this.markerCandleTime = null;
    this.maxCandlesToWaitForPullback = 10;
    this.maxCandlesToWaitForEntry = 10;
    this.flipCandleIndex = null;
    this.markerCandleIndex = null;
  }

  reset() {
    this.state = 'IDLE';
    this.pullback = null;
    this.flipCandleIndex = null;
    this.markerCandleIndex = null;
  }

  /** Feed one closed candle. Returns an array of events emitted this tick. */
  onCandle(candle) {
    this.candles.push(candle);
    const s = this.settings;
    if (this.candles.length > 2000) this.candles.shift(); // bounded memory

    const closes = this.candles.map((c) => c.close);
    const { rsi, signal } = computeRsiWithSignal(closes, {
      length: s.rsiLength,
      smoothingLength: s.smoothingLength,
      smoothingType: s.smoothingType,
      midline: s.rsiMidline,
    });
    const emaFastSeries = ema(closes, s.doubleEmaFast);
    const emaSlowSeries = ema(closes, s.doubleEmaSlow);

    const i = this.candles.length - 1;
    const events = [];

    // --- STEP 1: RSI flip ---
    if (this.state === 'IDLE') {
      const bullishFlip =
        this.direction === 'CALL' &&
        rsi[i - 1] != null && rsi[i - 1] < s.rsiMidline &&
        crossedAbove(rsi, signal, i);
      const bearishFlip =
        this.direction === 'PUT' &&
        rsi[i - 1] != null && rsi[i - 1] > s.rsiMidline &&
        crossedBelow(rsi, signal, i);

      if (bullishFlip || bearishFlip) {
        this.state = 'WAITING_PULLBACK';
        this.flipCandleIndex = i;
        events.push({ type: 'RSI_FLIP', direction: this.direction, time: candle.time });
      }
      return events;
    }

    // --- STEP 2+3+4: find pullback candle & build/validate Gann box ---
    if (this.state === 'WAITING_PULLBACK') {
      if (i - this.flipCandleIndex > this.maxCandlesToWaitForPullback) {
        this.reset();
        return events;
      }
      const range = candle.high - candle.low;
      if (range > s.pullbackMaxPoints) return events; // not tight enough yet

      const emaFast = emaFastSeries[i];
      const emaSlow = emaSlowSeries[i];
      if (emaFast == null || emaSlow == null) return events;

      const trendOk = this.direction === 'CALL'
        ? candle.high > emaFast && candle.high > emaSlow && candle.close > Math.min(emaFast, emaSlow)
        : candle.low < emaFast && candle.low < emaSlow && candle.close < Math.max(emaFast, emaSlow);

      if (!trendOk) return events; // wait for a pullback that respects the trend filter

      const gannBox = buildGannBox({
        direction: this.direction,
        pullbackLow: candle.low,
        pullbackHigh: candle.high,
        ratios: s.gannRatios,
      });

      this.pullback = { candle, gannBox, emaFast, emaSlow, index: i };
      this.state = 'WAITING_MARKER';
      events.push({
        type: 'PULLBACK_FOUND',
        direction: this.direction,
        time: candle.time,
        candle,
        gannBox,
      });
      return events;
    }

    // --- STEP 5a: marker dot (close back above/below the double-EMA) ---
    if (this.state === 'WAITING_MARKER') {
      if (i - this.pullback.index > this.maxCandlesToWaitForEntry) {
        this.reset();
        return events;
      }
      // Invalidate if price takes out the pullback extreme against us.
      const invalidated = this.direction === 'CALL'
        ? candle.low < this.pullback.candle.low
        : candle.high > this.pullback.candle.high;
      if (invalidated) {
        this.reset();
        events.push({ type: 'SETUP_INVALIDATED', direction: this.direction, time: candle.time });
        return events;
      }

      const emaFast = emaFastSeries[i];
      const emaSlow = emaSlowSeries[i];
      if (emaFast == null || emaSlow == null) return events;

      const closedThrough = this.direction === 'CALL'
        ? candle.close > Math.max(emaFast, emaSlow)
        : candle.close < Math.min(emaFast, emaSlow);

      if (closedThrough) {
        this.markerCandleIndex = i;
        this.state = 'WAITING_ENTRY';
        events.push({
          type: 'MARKER_DOT',
          direction: this.direction,
          time: candle.time,
          color: this.direction === 'CALL' ? s.style.greenDotColor : s.style.redDotColor,
        });
      }
      return events;
    }

    // --- STEP 5b: entry trigger (close breaks Gann 0.25) ---
    if (this.state === 'WAITING_ENTRY') {
      if (i - this.markerCandleIndex > this.maxCandlesToWaitForEntry) {
        this.reset();
        return events;
      }
      const invalidated = this.direction === 'CALL'
        ? candle.low < this.pullback.candle.low
        : candle.high > this.pullback.candle.high;
      if (invalidated) {
        this.reset();
        events.push({ type: 'SETUP_INVALIDATED', direction: this.direction, time: candle.time });
        return events;
      }

      const entryLevel = this.pullback.gannBox.entryLevel;
      if (reachedLevel(this.direction, candle.close, entryLevel)) {
        events.push({
          type: 'ENTRY_SIGNAL',
          direction: this.direction,
          time: candle.time,
          symbol: this.symbol,
          entryPrice: candle.close,
          gannBox: this.pullback.gannBox,
          pullbackCandle: this.pullback.candle,
        });
        this.reset();
      }
      return events;
    }

    return events;
  }
}
