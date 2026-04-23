/**
 * supportResistance.js
 *
 * Finds the nearest historical Support and Resistance levels relative to
 * the signal candle's close price using pivot-high / pivot-low detection.
 *
 * NO API calls — works purely on cached candles already in memory.
 * Called ONCE after a confirmed signal, purely for informational annotation.
 *
 * Usage:
 *   const { analyzeSRContext } = require('./supportResistance');
 *   const sr = analyzeSRContext(candles, currentPrice, 'BULLISH_CROSSOVER');
 *   console.log(sr.nearestSupport, sr.nearestResistance, sr.summary);
 */

const moment = require('moment');

/**
 * @param {Array}  candles       - Raw OHLCV arrays: [timestamp, open, high, low, close, volume]
 * @param {number} currentPrice  - The signal candle close price
 * @param {string} crossoverType - 'BULLISH_CROSSOVER' | 'BEARISH_CROSSOVER'
 * @param {Object} options
 * @param {number} options.pivotWindow  - Candles each side to qualify a pivot (default 5)
 * @param {number} options.lookback     - Max candles to search back (default 200)
 * @param {number} options.clusterPct  - % within which levels are merged (default 0.3%)
 * @returns {Object} SR context
 */
function analyzeSRContext(candles, currentPrice, crossoverType, options = {}) {
  const {
    pivotWindow = 5,
    lookback    = 200,
    clusterPct  = 0.003,
  } = options;

  if (!candles || candles.length < pivotWindow * 2 + 1) {
    return _emptySR(currentPrice, 'Not enough candles for S/R detection');
  }

  const window = candles.slice(-Math.min(lookback, candles.length));

  // ── Detect pivot highs (resistance candidates) ──
  const pivotHighs = [];
  const pivotLows  = [];

  for (let i = pivotWindow; i < window.length - pivotWindow; i++) {
    const high = parseFloat(window[i][2]);
    const low  = parseFloat(window[i][3]);
    const ts   = window[i][0];

    // Pivot high: higher than pivotWindow candles on each side
    const isHigh = _isPivotHigh(window, i, pivotWindow);
    const isLow  = _isPivotLow(window, i, pivotWindow);

    if (isHigh) pivotHighs.push({ price: high, timestamp: ts });
    if (isLow)  pivotLows.push({  price: low,  timestamp: ts });
  }

  // Also include the most recent swing high/low as fallback
  if (pivotHighs.length === 0) {
    const maxHigh = Math.max(...window.map(c => parseFloat(c[2])));
    const maxIdx  = window.findIndex(c => parseFloat(c[2]) === maxHigh);
    pivotHighs.push({ price: maxHigh, timestamp: window[maxIdx][0] });
  }
  if (pivotLows.length === 0) {
    const minLow = Math.min(...window.map(c => parseFloat(c[3])));
    const minIdx = window.findIndex(c => parseFloat(c[3]) === minLow);
    pivotLows.push({ price: minLow, timestamp: window[minIdx][0] });
  }

  // ── Cluster nearby levels ──
  const resistanceLevels = _clusterLevels(pivotHighs, clusterPct);
  const supportLevels    = _clusterLevels(pivotLows,  clusterPct);

  // ── Find nearest above (resistance) and nearest below (support) ──
  const aboveLevels = resistanceLevels.filter(l => l.price > currentPrice);
  const belowLevels = supportLevels.filter(l => l.price < currentPrice);

  const nearestResistance = aboveLevels.length
    ? aboveLevels.reduce((a, b) => a.price < b.price ? a : b)
    : null;

  const nearestSupport = belowLevels.length
    ? belowLevels.reduce((a, b) => a.price > b.price ? a : b)
    : null;

  // ── Distance calculations ──
  const supportDist = nearestSupport
    ? +((currentPrice - nearestSupport.price) / currentPrice * 100).toFixed(2)
    : null;

  const resistanceDist = nearestResistance
    ? +((nearestResistance.price - currentPrice) / currentPrice * 100).toFixed(2)
    : null;

  // ── Risk-reward to nearest levels ──
  let rrToLevels = null;
  if (nearestSupport && nearestResistance) {
    const upside   = nearestResistance.price - currentPrice;
    const downside  = currentPrice - nearestSupport.price;
    rrToLevels = downside > 0 ? +(upside / downside).toFixed(2) : null;
  }

  // ── Contextual message ──
  let contextNote = '';
  if (crossoverType === 'BULLISH_CROSSOVER') {
    if (nearestResistance && resistanceDist < 1.0) {
      contextNote = `⚠️ Resistance very close (${resistanceDist}% above) — tight upside room`;
    } else if (nearestSupport && supportDist < 0.5) {
      contextNote = `✅ Signal near strong support — good risk base`;
    } else {
      contextNote = rrToLevels >= 1.5
        ? `✅ Favourable R:R to levels (${rrToLevels}:1)`
        : rrToLevels !== null
          ? `ℹ️ R:R to levels: ${rrToLevels}:1`
          : '';
    }
  } else if (crossoverType === 'BEARISH_CROSSOVER') {
    if (nearestSupport && supportDist < 1.0) {
      contextNote = `⚠️ Support very close (${supportDist}% below) — tight downside room`;
    } else if (nearestResistance && resistanceDist < 0.5) {
      contextNote = `✅ Signal near strong resistance — good short base`;
    } else {
      contextNote = rrToLevels >= 1.5
        ? `✅ Favourable R:R to levels (${rrToLevels}:1)`
        : rrToLevels !== null
          ? `ℹ️ R:R to levels: ${rrToLevels}:1`
          : '';
    }
  }

  const supportStr     = nearestSupport
    ? `₹${nearestSupport.price.toFixed(2)} (${supportDist}% below)`
    : 'N/A';

  const resistanceStr  = nearestResistance
    ? `₹${nearestResistance.price.toFixed(2)} (${resistanceDist}% above)`
    : 'N/A';

  return {
    currentPrice,
    nearestSupport:     nearestSupport?.price    ?? null,
    nearestResistance:  nearestResistance?.price ?? null,
    supportDist,
    resistanceDist,
    rrToLevels,
    supportStr,
    resistanceStr,
    contextNote,
    allResistanceLevels: resistanceLevels.map(l => +l.price.toFixed(2)),
    allSupportLevels:    supportLevels.map(l => +l.price.toFixed(2)),
    summary: [
      `🔴 Resistance : ${resistanceStr}`,
      `🟢 Support    : ${supportStr}`,
      contextNote
    ].filter(Boolean).join('\n'),
    pivotCount: {
      resistance: resistanceLevels.length,
      support:    supportLevels.length
    }
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _isPivotHigh(candles, idx, window) {
  const refHigh = parseFloat(candles[idx][2]);
  for (let j = idx - window; j <= idx + window; j++) {
    if (j === idx) continue;
    if (j < 0 || j >= candles.length) continue;
    if (parseFloat(candles[j][2]) > refHigh) return false;
  }
  return true;
}

function _isPivotLow(candles, idx, window) {
  const refLow = parseFloat(candles[idx][3]);
  for (let j = idx - window; j <= idx + window; j++) {
    if (j === idx) continue;
    if (j < 0 || j >= candles.length) continue;
    if (parseFloat(candles[j][3]) < refLow) return false;
  }
  return true;
}

/** Merge price levels that are within clusterPct of each other */
function _clusterLevels(pivots, clusterPct) {
  if (!pivots.length) return [];

  // Sort by price ascending
  const sorted = [...pivots].sort((a, b) => a.price - b.price);
  const clusters = [];
  let current = { ...sorted[0], touches: 1 };

  for (let i = 1; i < sorted.length; i++) {
    const pct = (sorted[i].price - current.price) / current.price;
    if (pct <= clusterPct) {
      // Merge: keep the most recent timestamp, average the price
      current.price = (current.price * current.touches + sorted[i].price) / (current.touches + 1);
      current.touches++;
      if (sorted[i].timestamp > current.timestamp) {
        current.timestamp = sorted[i].timestamp;
      }
    } else {
      clusters.push({ ...current });
      current = { ...sorted[i], touches: 1 };
    }
  }
  clusters.push({ ...current });

  // Sort by touches (stronger levels first), then recency
  return clusters.sort((a, b) => b.touches - a.touches || b.timestamp - a.timestamp);
}

function _emptySR(currentPrice, reason) {
  return {
    currentPrice,
    nearestSupport: null,
    nearestResistance: null,
    supportDist: null,
    resistanceDist: null,
    rrToLevels: null,
    supportStr: 'N/A',
    resistanceStr: 'N/A',
    contextNote: '',
    allResistanceLevels: [],
    allSupportLevels: [],
    summary: `ℹ️ S/R: ${reason}`,
    pivotCount: { resistance: 0, support: 0 }
  };
}

module.exports = { analyzeSRContext };