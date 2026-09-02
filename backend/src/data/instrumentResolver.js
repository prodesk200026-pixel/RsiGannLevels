import { config } from '../config/index.js';

/**
 * Both Dhan and Angel One identify instruments by numeric tokens that
 * come from a periodically-published instrument master file, not by
 * plain symbol name. Hardcoding today's NIFTY/BANKNIFTY spot tokens
 * here as a starting point — swap in a real instrument-master loader
 * (Dhan: `api-scrip-master.csv`, Angel: `OpenAPIScripMaster.json`)
 * before going live, since tokens/lot sizes change on rebalancing.
 */
const UNDERLYING_META = {
  NIFTY: {
    tradingSymbol: 'NIFTY',
    exchangeSegment: 'IDX_I', // Dhan index segment
    angelSymbolToken: '99926000',
    angelExchange: 'NSE',
    lotSize: 25,
    strikeStep: 50,
  },
  BANKNIFTY: {
    tradingSymbol: 'BANKNIFTY',
    exchangeSegment: 'IDX_I',
    angelSymbolToken: '99926009',
    angelExchange: 'NSE',
    lotSize: 15,
    strikeStep: 100,
  },
  SENSEX: {
    tradingSymbol: 'SENSEX',
    exchangeSegment: 'IDX_I',
    angelSymbolToken: '99919000',
    angelExchange: 'BSE',
    lotSize: 10,
    strikeStep: 100,
  },
};

export function listUnderlyings() {
  return config.underlyings.filter((u) => UNDERLYING_META[u]);
}

export function resolveMicrostructureInstrument(symbol) {
  const meta = UNDERLYING_META[symbol];
  if (!meta) throw new Error(`Unknown underlying: ${symbol}`);
  return { symbol, ...meta };
}
