// ema.js
const EMA_PERIOD = 9;

function calcEMA(values, period) {
  if (values.length < period) return new Array(values.length).fill(null);
  const result = new Array(values.length).fill(null);
  const mult = 2 / (period + 1);
  const seed = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result[period - 1] = seed;
  let prev = seed;
  for (let i = period; i < values.length; i++) {
    result[i] = (values[i] - prev) * mult + prev;
    prev = result[i];
  }
  return result;
}

// For strategy.js — raw candle arrays [ts,open,high,low,close,vol]
function attachEMA(rawCandles) {
  const highs = rawCandles.map(c => parseFloat(c[2]));
  const lows  = rawCandles.map(c => parseFloat(c[3]));
  const ema9Highs = calcEMA(highs, EMA_PERIOD);
  const ema9Lows  = calcEMA(lows,  EMA_PERIOD);
  return rawCandles.map((c, i) => ({
    ts: c[0],
    open: parseFloat(c[1]), high: parseFloat(c[2]),
    low:  parseFloat(c[3]), close: parseFloat(c[4]),
    volume: parseFloat(c[5]),
    ema9High: ema9Highs[i], ema9Low: ema9Lows[i],
  }));
}

// For server.js chart API — already-formatted {ts,open,high,low,close,volume} objects
function attachEMAFormatted(candles) {
  const highs  = candles.map(c => c.high);
  const lows   = candles.map(c => c.low);
  const closes = candles.map(c => c.close);
  const ema9Highs  = calcEMA(highs,  EMA_PERIOD);
  const ema9Lows   = calcEMA(lows,   EMA_PERIOD);
  const ema9Closes = calcEMA(closes, EMA_PERIOD);
  return candles.map((c, i) => ({
    ...c,
    ema9High:  ema9Highs[i],
    ema9Low:   ema9Lows[i],
    ema9Close: ema9Closes[i],
  }));
}

// Resample 3-min candles to higher timeframe (5,15,60 min, etc.)
function resampleCandles(candles, targetMinutes) {
  if (targetMinutes <= 3) return candles;
  const buckets = new Map();
  for (const c of candles) {
    const bucketTs = Math.floor(c.ts / (targetMinutes * 60)) * (targetMinutes * 60);
    if (!buckets.has(bucketTs)) {
      buckets.set(bucketTs, { ts: bucketTs, time: bucketTs, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume });
    } else {
      const b = buckets.get(bucketTs);
      b.high   = Math.max(b.high, c.high);
      b.low    = Math.min(b.low,  c.low);
      b.close  = c.close;
      b.volume += c.volume;
    }
  }
  return Array.from(buckets.values()).sort((a, b) => a.ts - b.ts);
}

module.exports = { attachEMA, attachEMAFormatted, resampleCandles, calcEMA, EMA_PERIOD };
