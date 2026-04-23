/**
 * phaseDetector.js
 * 
 * Detects Wyckoff-style market phases using BCVC candle data:
 *   ACCUMULATION  — price compressed near lows, low volatility, buyers absorbing supply
 *   DISTRIBUTION  — price compressed near highs, low volatility, sellers offloading
 *   MARKUP        — sustained bullish trend
 *   MARKDOWN      — sustained bearish trend
 *   UNKNOWN       — insufficient data
 *
 * Designed to be called ONCE after a signal is confirmed.
 * NO loops, NO API calls — works purely on cached candles already in memory.
 *
 * Usage:
 *   const { detectPhase } = require('./phaseDetector');
 *   const result = detectPhase(candles, 26);  // last 26 candles = ~1 trading day on 15m
 *   console.log(result.phase, result.summary);
 *   const ok = result.phaseSupports('BULLISH_CROSSOVER'); // true/false
 */

const moment = require('moment');

/**
 * @param {Array} candles  - Raw OHLCV arrays: [timestamp, open, high, low, close, volume]
 * @param {number} lookback - How many recent candles to analyse (default 26 = ~1 trading day)
 * @returns {Object} phase result
 */
function detectPhase(candles, lookback = 26) {
  if (!candles || candles.length < lookback + 5) {
    return _unknown('Not enough candles');
  }

  // Use the most recent `lookback` candles
  const window = candles.slice(-lookback);

  const opens   = window.map(c => parseFloat(c[1]));
  const highs   = window.map(c => parseFloat(c[2]));
  const lows    = window.map(c => parseFloat(c[3]));
  const closes  = window.map(c => parseFloat(c[4]));
  const volumes = window.map(c => parseFloat(c[5]));

  const windowHigh  = Math.max(...highs);
  const windowLow   = Math.min(...lows);
  const windowRange = windowHigh - windowLow;

  if (windowRange === 0) return _unknown('Zero price range');

  // ── Price position (where does the current close sit in the window range?) ──
  const currentClose = closes[closes.length - 1];
  const pricePosition = (currentClose - windowLow) / windowRange; // 0 = bottom, 1 = top

  // ── Volatility: avg candle range as % of window range ──
  const avgCandleRange = window.reduce((sum, c) => {
    return sum + (parseFloat(c[2]) - parseFloat(c[3]));
  }, 0) / window.length;
  const relativeVolatility = avgCandleRange / windowRange; // lower = more compressed

  // ── Trend slope: simple linear regression on closes ──
  const slope = _linearSlope(closes);
  const normalizedSlope = slope / (windowRange / closes.length); // normalise by avg range per candle

  // ── Volume trend: is volume rising or falling? ──
  const earlyVolAvg = _mean(volumes.slice(0, Math.floor(lookback / 2)));
  const lateVolAvg  = _mean(volumes.slice(Math.floor(lookback / 2)));
  const volumeTrend = lateVolAvg > earlyVolAvg ? 'RISING' : 'FALLING';

  // ── Up vs down candle balance ──
  const upCandles   = window.filter(c => parseFloat(c[4]) >= parseFloat(c[1])).length;
  const downCandles = window.length - upCandles;
  const candleBalance = upCandles / window.length; // > 0.5 = bullish bias

  // ── Classification ──
  let phase, confidence, description;

  const isCompressed     = relativeVolatility < 0.25;
  const isStrongUpTrend  = normalizedSlope > 0.4;
  const isStrongDownTrend= normalizedSlope < -0.4;
  const isNearLow        = pricePosition < 0.35;
  const isNearHigh       = pricePosition > 0.65;

  if (isStrongUpTrend && !isCompressed) {
    phase       = 'MARKUP';
    confidence  = Math.min(95, Math.round(60 + normalizedSlope * 30));
    description = 'Price in sustained uptrend (Markup phase)';
  } else if (isStrongDownTrend && !isCompressed) {
    phase       = 'MARKDOWN';
    confidence  = Math.min(95, Math.round(60 + Math.abs(normalizedSlope) * 30));
    description = 'Price in sustained downtrend (Markdown phase)';
  } else if (isCompressed && isNearLow) {
    phase       = 'ACCUMULATION';
    confidence  = Math.round(55 + (0.35 - pricePosition) * 80 + (0.25 - relativeVolatility) * 60);
    confidence  = Math.min(90, Math.max(50, confidence));
    description = 'Price compressed near lows — possible accumulation zone';
  } else if (isCompressed && isNearHigh) {
    phase       = 'DISTRIBUTION';
    confidence  = Math.round(55 + (pricePosition - 0.65) * 80 + (0.25 - relativeVolatility) * 60);
    confidence  = Math.min(90, Math.max(50, confidence));
    description = 'Price compressed near highs — possible distribution zone';
  } else if (isNearLow && candleBalance > 0.55) {
    phase       = 'ACCUMULATION';
    confidence  = 52;
    description = 'Bullish candle bias near lows — possible early accumulation';
  } else if (isNearHigh && candleBalance < 0.45) {
    phase       = 'DISTRIBUTION';
    confidence  = 52;
    description = 'Bearish candle bias near highs — possible early distribution';
  } else {
    phase       = 'NEUTRAL';
    confidence  = 40;
    description = 'No clear accumulation or distribution pattern detected';
  }

  const emoji = {
    ACCUMULATION: '🟦',
    DISTRIBUTION: '🟥',
    MARKUP:       '📈',
    MARKDOWN:     '📉',
    NEUTRAL:      '⬜',
    UNKNOWN:      '❓'
  }[phase] || '❓';

  return {
    phase,
    confidence,
    description,
    emoji,
    metrics: {
      pricePosition:      +pricePosition.toFixed(3),
      relativeVolatility: +relativeVolatility.toFixed(3),
      normalizedSlope:    +normalizedSlope.toFixed(3),
      volumeTrend,
      candleBalance:      +candleBalance.toFixed(2),
      windowHigh:         +windowHigh.toFixed(2),
      windowLow:          +windowLow.toFixed(2),
      windowRange:        +windowRange.toFixed(2),
      lookbackCandles:    lookback,
    },
    summary: `${emoji} ${phase} (${confidence}% confidence) — ${description}`,
    /**
     * Returns true if this phase logically supports the given signal direction.
     * For informational use — does NOT block signal sending.
     */
    phaseSupports(crossoverType) {
      if (crossoverType === 'BULLISH_CROSSOVER') {
        return phase === 'ACCUMULATION' || phase === 'MARKUP';
      }
      if (crossoverType === 'BEARISH_CROSSOVER') {
        return phase === 'DISTRIBUTION' || phase === 'MARKDOWN';
      }
      return false;
    }
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/** Simple least-squares slope (rise per candle) */
function _linearSlope(values) {
  const n = values.length;
  if (n < 2) return 0;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX  += i;
    sumY  += values[i];
    sumXY += i * values[i];
    sumX2 += i * i;
  }
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

function _unknown(reason) {
  return {
    phase: 'UNKNOWN',
    confidence: 0,
    description: reason,
    emoji: '❓',
    metrics: {},
    summary: `❓ UNKNOWN — ${reason}`,
    phaseSupports: () => null
  };
}

module.exports = { detectPhase };