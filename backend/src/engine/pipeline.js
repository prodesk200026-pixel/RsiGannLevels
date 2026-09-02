import { EntrySignalEngine } from './entrySignalEngine.js';
import { AtmCrossEngine } from './atmCrossEngine.js';
import { OptionChainAnalytics } from './optionChainAnalytics.js';
import { selectStrike } from './strikeSelector.js';
import { buildTradeCard } from './tradeCardBuilder.js';

export class Pipeline {
  constructor({ settingsStore, alertManager, io }) {
    this.settingsStore = settingsStore;
    this.alertManager = alertManager;
    this.io = io;
    this.entryEngines = new Map(); // `${symbol}:${direction}` -> EntrySignalEngine
    this.chainAnalytics = new OptionChainAnalytics();
    this.atmIvEngines = new Map(); // symbol -> AtmCrossEngine
    this.atmStraddleEngines = new Map();
    this.latestChain = new Map(); // symbol -> enriched chain, for the strike selector
  }

  #entryEngine(symbol, direction) {
    const key = `${symbol}:${direction}`;
    if (!this.entryEngines.has(key)) {
      this.entryEngines.set(key, new EntrySignalEngine(symbol, direction, this.settingsStore.get(symbol)));
    }
    // Keep engine settings live-synced with the settings store (customisable inputs).
    this.entryEngines.get(key).settings = this.settingsStore.get(symbol);
    return this.entryEngines.get(key);
  }

  onCandleClose(symbol, timeframe, candle) {
    if (timeframe !== '1m') return; // strategy runs on 1-minute candles; change here to retime it
    for (const direction of ['CALL', 'PUT']) {
      const engine = this.#entryEngine(symbol, direction);
      const events = engine.onCandle(candle);
      for (const event of events) this.#handleEngineEvent(symbol, event);
    }
    this.io.emit('candle', { symbol, timeframe, candle });
  }

  #handleEngineEvent(symbol, event) {
    this.io.emit('engineEvent', event);
    if (event.type !== 'ENTRY_SIGNAL') return;

    const chain = this.latestChain.get(symbol);
    if (!chain) return; // no option-chain snapshot yet — can't pick a strike

    const settings = this.settingsStore.get(symbol);
    const strikeInfo = selectStrike(chain, event.direction, {
      min: settings.strikePremiumMin,
      max: settings.strikePremiumMax,
    });
    if (!strikeInfo) return; // nothing in the configured premium band right now

    const card = buildTradeCard({ direction: event.direction, strikeInfo, chainContext: chain });
    this.alertManager.fireEntrySignal(symbol, card);
  }

  onOptionSnapshot(symbol, rawSnapshot) {
    const enriched = this.chainAnalytics.enrich(rawSnapshot);
    this.latestChain.set(symbol, enriched);
    this.io.emit('optionChain', enriched);

    const atmRow = [...enriched.rows].sort(
      (a, b) => Math.abs(a.strike - enriched.spot) - Math.abs(b.strike - enriched.spot)
    )[0];
    if (!atmRow?.ce || !atmRow?.pe) return;

    const atmStraddle = atmRow.ce.ltp + atmRow.pe.ltp;
    const atmIv = (atmRow.ce.iv + atmRow.pe.iv) / 2;
    const time = enriched.timestamp;

    if (!this.atmIvEngines.has(symbol)) this.atmIvEngines.set(symbol, new AtmCrossEngine(symbol, 'ATM_IV'));
    if (!this.atmStraddleEngines.has(symbol)) this.atmStraddleEngines.set(symbol, new AtmCrossEngine(symbol, 'ATM_STRADDLE'));

    const ivEvent = this.atmIvEngines.get(symbol).push({ time, price: enriched.spot, metric: atmIv });
    const straddleEvent = this.atmStraddleEngines.get(symbol).push({ time, price: enriched.spot, metric: atmStraddle });

    this.io.emit('atmSeries', { symbol, time, spot: enriched.spot, atmIv, atmStraddle });
    if (ivEvent) this.alertManager.fireAtmCross(ivEvent);
    if (straddleEvent) this.alertManager.fireAtmCross(straddleEvent);
  }
}
