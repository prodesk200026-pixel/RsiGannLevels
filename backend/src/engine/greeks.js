// Standard Black-Scholes Greeks. Used to enrich broker option-chain
// rows that don't already ship Greeks (Dhan's option-chain endpoint
// does include Greeks; Angel One's does not, so this fills the gap
// there and keeps both adapters returning the same shape).

function erf(x) {
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return sign * y;
}

function cdf(x) {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

function pdf(x) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/**
 * @param spot underlying price
 * @param strike option strike
 * @param timeToExpiryYears years remaining (e.g. 3 days = 3/365)
 * @param ivPercent implied volatility, in percent (e.g. 15 for 15%)
 * @param rate risk-free rate as a decimal (default ~7% India)
 * @param type 'CE' | 'PE'
 */
export function blackScholesGreeks({ spot, strike, timeToExpiryYears, ivPercent, rate = 0.07, type }) {
  if (!spot || !strike || !timeToExpiryYears || !ivPercent || timeToExpiryYears <= 0) {
    return { delta: null, gamma: null, theta: null, vega: null };
  }
  const sigma = ivPercent / 100;
  const d1 = (Math.log(spot / strike) + (rate + (sigma * sigma) / 2) * timeToExpiryYears) /
    (sigma * Math.sqrt(timeToExpiryYears));
  const d2 = d1 - sigma * Math.sqrt(timeToExpiryYears);

  const gamma = pdf(d1) / (spot * sigma * Math.sqrt(timeToExpiryYears));
  const vega = (spot * pdf(d1) * Math.sqrt(timeToExpiryYears)) / 100; // per 1% IV move

  let delta, theta;
  if (type === 'CE') {
    delta = cdf(d1);
    theta = (-(spot * pdf(d1) * sigma) / (2 * Math.sqrt(timeToExpiryYears)) -
      rate * strike * Math.exp(-rate * timeToExpiryYears) * cdf(d2)) / 365;
  } else {
    delta = cdf(d1) - 1;
    theta = (-(spot * pdf(d1) * sigma) / (2 * Math.sqrt(timeToExpiryYears)) +
      rate * strike * Math.exp(-rate * timeToExpiryYears) * cdf(-d2)) / 365;
  }

  return { delta, gamma, theta, vega };
}
