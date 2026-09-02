/**
 * Reproduces the two reference charts (ATM IV vs Price, ATM Straddle
 * vs Price): both series are plotted together and the interesting
 * moment is the CROSSOVER point, in either direction. Near expiry
 * these two lines cross hard as IV/premium collapses while price
 * keeps moving — that crossing gets its own, separate alarm from the
 * entry-signal alarm.
 *
 * Both series are min-max normalised to 0-100 over a rolling window
 * before comparing, since price (e.g. 24,055) and IV (e.g. 15-55) or
 * straddle premium (e.g. 60-160) live on completely different scales
 * — exactly like the dual-axis charts supplied as reference.
 */
export class AtmCrossEngine {
  constructor(symbol, seriesName, windowSize = 120) {
    this.symbol = symbol;
    this.seriesName = seriesName; // 'ATM_IV' | 'ATM_STRADDLE'
    this.windowSize = windowSize;
    this.points = []; // {time, price, metric}
    this.lastRelation = null; // 'ABOVE' | 'BELOW' (metric relative to price, both normalised)
  }

  static normalise(values) {
    const finite = values.filter((v) => v != null);
    if (!finite.length) return values.map(() => null);
    const min = Math.min(...finite);
    const max = Math.max(...finite);
    const range = max - min || 1;
    return values.map((v) => (v == null ? null : ((v - min) / range) * 100));
  }

  push(point) {
    this.points.push(point);
    if (this.points.length > this.windowSize) this.points.shift();

    if (this.points.length < 3) return null;

    const prices = AtmCrossEngine.normalise(this.points.map((p) => p.price));
    const metrics = AtmCrossEngine.normalise(this.points.map((p) => p.metric));

    const i = this.points.length - 1;
    const relation = metrics[i] > prices[i] ? 'ABOVE' : 'BELOW';

    let event = null;
    if (this.lastRelation && relation !== this.lastRelation) {
      event = {
        type: 'ATM_CROSS',
        seriesName: this.seriesName,
        symbol: this.symbol,
        time: point.time,
        direction: relation === 'ABOVE' ? 'METRIC_CROSSED_UP' : 'METRIC_CROSSED_DOWN',
        price: point.price,
        metric: point.metric,
      };
    }
    this.lastRelation = relation;
    return event;
  }
}
