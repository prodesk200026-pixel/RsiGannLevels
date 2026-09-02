export class AlertManager {
  constructor({ pushService, io }) {
    this.pushService = pushService;
    this.io = io;
    this.history = []; // "Log Book" tab reads this via /api/history
  }

  async fireEntrySignal(symbol, tradeCard) {
    const record = {
      id: `${symbol}-${Date.now()}`,
      kind: 'ENTRY',
      symbol,
      time: Date.now(),
      ...tradeCard,
    };
    this.history.unshift(record);
    this.history = this.history.slice(0, 200);

    this.io.emit('signal', record);
    await this.pushService.broadcast({
      type: 'ENTRY',
      title: `${tradeCard.action} — ${symbol} ${tradeCard.strike} ${tradeCard.optionType}`,
      body: `Entry ₹${tradeCard.entryPrice} · SL ₹${tradeCard.stopLoss.price} · Target ₹${tradeCard.target.price} · confidence ${tradeCard.confidence}/100`,
      tag: `entry-${symbol}`,
      data: record,
    });
  }

  async fireAtmCross(event) {
    this.history.unshift({ id: `${event.symbol}-atm-${Date.now()}`, kind: 'ATM_CROSS', ...event });
    this.history = this.history.slice(0, 200);

    this.io.emit('atmCross', event);
    await this.pushService.broadcast({
      type: 'ATM_CROSS',
      title: `${event.seriesName.replace('_', ' ')} × Price cross — ${event.symbol}`,
      body: event.direction === 'METRIC_CROSSED_UP'
        ? `${event.seriesName} crossed above price`
        : `${event.seriesName} crossed below price`,
      tag: `atmcross-${event.symbol}-${event.seriesName}`,
      data: event,
    });
  }

  getHistory(limit = 100) {
    return this.history.slice(0, limit);
  }
}
