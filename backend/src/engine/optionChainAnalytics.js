import { blackScholesGreeks } from './greeks.js';

/**
 * Keeps the last two option-chain snapshots per symbol so we can
 * compute "change in OI", "change in volume" and detect volume
 * SHIFTING between strikes (not just rising everywhere) — the thing
 * that actually tells you where fresh positioning is landing.
 */
export class OptionChainAnalytics {
  constructor() {
    this.previous = new Map(); // symbol -> snapshot
  }

  /**
   * snapshot: { symbol, spot, expiry, timeToExpiryYears, rows: [
   *   { strike, ce: {ltp, oi, volume, iv}, pe: {ltp, oi, volume, iv} }
   * ]}
   */
  enrich(snapshot) {
    const prev = this.previous.get(snapshot.symbol);
    const prevByStrike = new Map((prev?.rows || []).map((r) => [r.strike, r]));

    let totalCallOi = 0, totalPutOi = 0;
    let maxCallOiRow = null, maxPutOiRow = null;

    const rows = snapshot.rows.map((row) => {
      const prevRow = prevByStrike.get(row.strike);
      const out = { strike: row.strike };

      for (const side of ['ce', 'pe']) {
        const cur = row[side];
        if (!cur) { out[side] = null; continue; }
        const greeks = blackScholesGreeks({
          spot: snapshot.spot,
          strike: row.strike,
          timeToExpiryYears: snapshot.timeToExpiryYears,
          ivPercent: cur.iv,
          type: side === 'ce' ? 'CE' : 'PE',
        });
        const prevSide = prevRow?.[side];
        out[side] = {
          ...cur,
          ...greeks,
          changeInOi: prevSide ? cur.oi - prevSide.oi : 0,
          changeInVolume: prevSide ? cur.volume - prevSide.volume : 0,
        };
      }

      if (out.ce) totalCallOi += out.ce.oi || 0;
      if (out.pe) totalPutOi += out.pe.oi || 0;
      if (out.ce && (!maxCallOiRow || out.ce.oi > maxCallOiRow.ce.oi)) maxCallOiRow = out;
      if (out.pe && (!maxPutOiRow || out.pe.oi > maxPutOiRow.pe.oi)) maxPutOiRow = out;

      return out;
    });

    const pcr = totalCallOi ? totalPutOi / totalCallOi : null;

    const enriched = {
      symbol: snapshot.symbol,
      spot: snapshot.spot,
      expiry: snapshot.expiry,
      timestamp: Date.now(),
      pcr,
      resistanceCallWall: maxCallOiRow ? maxCallOiRow.strike : null,
      supportPutWall: maxPutOiRow ? maxPutOiRow.strike : null,
      rows,
    };

    this.previous.set(snapshot.symbol, snapshot);
    return enriched;
  }
}
