/**
 * EMA 9 NH NL BC Signal Engine
 * Exact port of Pine Script v6 logic
 */

/**
 * Calculate EMA for a series of values
 * @param {number[]} values - array of prices (oldest first)
 * @param {number} period
 * @returns {number[]} ema values
 */
function calcEMA(values, period) {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const ema = new Array(values.length).fill(0);
  ema[0] = values[0];
  for (let i = 1; i < values.length; i++) {
    ema[i] = values[i] * k + ema[i - 1] * (1 - k);
  }
  return ema;
}

/**
 * Run Pine Script NH/NL/BC state machine on OHLC candles
 * @param {Array<{time, open, high, low, close}>} candles - oldest first
 * @returns {{ signals: Array, emaHighs: number[], emaLows: number[], state: object }}
 */
function runSignalEngine(candles) {
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);

  const emaHighs = calcEMA(highs, 9);
  const emaLows = calcEMA(lows, 9);

  // State machine (mirrors Pine Script var)
  let state = 0;       // 0=wait, 1=trackHigh, -1=trackLow, 2=trailLow, -2=trailHigh
  let bestPrice = null;
  let bestBar = null;

  const signals = [];

  for (let i = 0; i < candles.length; i++) {
    const bar = candles[i];
    const emaHigh = emaHighs[i];
    const emaLow = emaLows[i];

    const touchHigh = bar.high >= emaHigh;
    const touchLow = bar.low <= emaLow;
    const bothTouch = touchHigh && touchLow;

    if (bothTouch) {
      // BC signal - both sides touched
      signals.push({ type: "BC_HIGH", barIndex: i, price: bar.high, time: bar.time });
      signals.push({ type: "BC_LOW",  barIndex: i, price: bar.low,  time: bar.time });

      // Confirm pending state
      if (state === 1)  signals.push({ type: "NH", barIndex: bestBar, price: bestPrice, time: candles[bestBar].time });
      else if (state === -1) signals.push({ type: "NL", barIndex: bestBar, price: bestPrice, time: candles[bestBar].time });
      else if (state === 2)  signals.push({ type: "NL", barIndex: bestBar, price: bestPrice, time: candles[bestBar].time });
      else if (state === -2) signals.push({ type: "NH", barIndex: bestBar, price: bestPrice, time: candles[bestBar].time });

      // Full reset
      state = 0;
      bestPrice = null;
      bestBar = null;

    } else {

      if (state === 0) {
        if (touchHigh) {
          state = 1;
          bestPrice = bar.high;
          bestBar = i;
        } else if (touchLow) {
          state = -1;
          bestPrice = bar.low;
          bestBar = i;
        }

      } else if (state === 1) {
        if (touchHigh && (bestPrice === null || bar.high > bestPrice)) {
          bestPrice = bar.high;
          bestBar = i;
        }
        if (touchLow) {
          signals.push({ type: "NH", barIndex: bestBar, price: bestPrice, time: candles[bestBar].time });
          state = 2;
          bestPrice = bar.low;
          bestBar = i;
        }

      } else if (state === 2) {
        if (bar.low < bestPrice) {
          bestPrice = bar.low;
          bestBar = i;
        }
        if (touchHigh) {
          signals.push({ type: "NL", barIndex: bestBar, price: bestPrice, time: candles[bestBar].time });
          state = -2;
          bestPrice = bar.high;
          bestBar = i;
        }

      } else if (state === -1) {
        if (touchLow && (bestPrice === null || bar.low < bestPrice)) {
          bestPrice = bar.low;
          bestBar = i;
        }
        if (touchHigh) {
          signals.push({ type: "NL", barIndex: bestBar, price: bestPrice, time: candles[bestBar].time });
          state = -2;
          bestPrice = bar.high;
          bestBar = i;
        }

      } else if (state === -2) {
        if (bar.high > bestPrice) {
          bestPrice = bar.high;
          bestBar = i;
        }
        if (touchLow) {
          signals.push({ type: "NH", barIndex: bestBar, price: bestPrice, time: candles[bestBar].time });
          state = 2;
          bestPrice = bar.low;
          bestBar = i;
        }
      }
    }
  }

  return {
    signals,
    emaHighs,
    emaLows,
    currentState: state,
    bestPrice,
    bestBar,
  };
}

module.exports = { runSignalEngine, calcEMA };
