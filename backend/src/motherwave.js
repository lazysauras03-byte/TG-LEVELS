/**
 * motherwave.js
 * ─────────────────────────────────────────────────────────────────
 * Single source of truth for Mother Wave detection.
 * Used by scannerRunner.js — computed ONCE per symbol per scan,
 * then passed into every strategy via scan(symbol, candles, context).
 *
 * Strategies never recompute the mother wave themselves.
 *
 * Algorithm:
 *   1. Largest delta segment → first candidate.
 *   2. -0.168 fib invalidation:
 *      BULL: inv = toPrice + 0.168 × span  (above end HIGH)
 *      BEAR: inv = toPrice - 0.168 × span  (below end LOW)
 *   3. Walk segments after candidate chronologically:
 *      BULL invalidated by subsequent BULL toPrice > inv
 *      BEAR invalidated by subsequent BEAR toPrice < inv
 *   4. If invalidated → largest from remaining pool → repeat.
 *   5. Final candidate = Mother Wave.
 * ─────────────────────────────────────────────────────────────────
 */

"use strict";

// ─── EMA helper ───────────────────────────────────────────────────────────────
function calcEMA(prices, period) {
  const k = 2 / (period + 1);
  const out = new Array(prices.length).fill(null);
  let ema = null;
  for (let i = 0; i < prices.length; i++) {
    const p = prices[i];
    if (p == null || isNaN(p)) continue;
    ema = ema === null ? p : p * k + ema * (1 - k);
    out[i] = ema;
  }
  return out;
}

// ─── Wave segment computation (matches WavesIndicator.js) ─────────────────────
function computeSegments(candles) {
  if (!candles || candles.length < 5) return [];

  const eH = calcEMA(candles.map(c => c.high), 9);
  const eL = calcEMA(candles.map(c => c.low),  9);

  let state = 0, bestPrice = null, bestBar = null, legTouchedEMA = false;
  let lastPrice = null, lastBar = null, prevWaveType = "";
  let prevHigh = null, prevLow = null, currWaveType = "";
  const segments = [];

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const emaH = eH[i], emaL = eL[i];
    if (emaH == null || emaL == null) continue;

    const isGreen = c.close > c.open;
    const isRed   = c.close < c.open;
    const touchHigh = (isGreen && c.close > emaH) || (isRed && c.open > emaH);
    const touchLow  = (isGreen && c.open  < emaL) || (isRed && c.close < emaL);

    if (state === 0) {
      if (touchHigh) { state = 1;  bestPrice = c.high; bestBar = i; legTouchedEMA = true; }
      else if (touchLow)  { state = -1; bestPrice = c.low;  bestBar = i; legTouchedEMA = true; }
      continue;
    }

    if (state === 1) {
      if (c.high > bestPrice) { bestPrice = c.high; bestBar = i; }
      if (touchHigh) legTouchedEMA = true;
      if (touchLow && legTouchedEMA) {
        const lp = bestPrice, lb = bestBar;
        currWaveType = prevHigh === null ? "HH" : lp > prevHigh ? "HH" : "LH";
        prevHigh = lp;
        if (lastPrice !== null) {
          segments.push({
            fromBarIndex: lastBar, fromPrice: lastPrice,
            toBarIndex: lb, toPrice: lp, toSide: "high",
            fromTime: candles[lastBar].time, toTime: candles[lb].time,
            prevWaveType, currWaveType,
          });
        }
        prevWaveType = currWaveType; lastPrice = lp; lastBar = lb;
        state = -1; bestPrice = c.low; bestBar = i; legTouchedEMA = touchLow;
      }
      continue;
    }

    if (state === -1) {
      if (c.low < bestPrice) { bestPrice = c.low; bestBar = i; }
      if (touchLow) legTouchedEMA = true;
      if (touchHigh && legTouchedEMA) {
        const lp = bestPrice, lb = bestBar;
        currWaveType = prevLow === null ? "LL" : lp < prevLow ? "LL" : "HL";
        prevLow = lp;
        if (lastPrice !== null) {
          segments.push({
            fromBarIndex: lastBar, fromPrice: lastPrice,
            toBarIndex: lb, toPrice: lp, toSide: "low",
            fromTime: candles[lastBar].time, toTime: candles[lb].time,
            prevWaveType, currWaveType,
          });
        }
        prevWaveType = currWaveType; lastPrice = lp; lastBar = lb;
        state = 1; bestPrice = c.high; bestBar = i; legTouchedEMA = touchHigh;
      }
      continue;
    }
  }

  return segments;
}

// ─── Core detection ───────────────────────────────────────────────────────────
function detectMotherWave(candles) {
  const segs = computeSegments(candles);
  if (!segs.length) return null;

  const byTime  = [...segs].sort((a, b) => a.fromTime - b.fromTime);
  const span    = s => Math.abs(s.toPrice - s.fromPrice);
  const isBull  = s => s.toSide === "high";
  const largest = pool => pool.reduce((b, s) => span(s) > span(b) ? s : b, pool[0]);

  const invLevel = s => isBull(s)
    ? s.toPrice + 0.168 * span(s)   // above end HIGH
    : s.toPrice - 0.168 * span(s);  // below end LOW

  const crosses = (candidate, inv, seg) => {
    if (seg.fromTime <= candidate.toTime) return false;
    return isBull(candidate)
      ? isBull(seg)  && seg.toPrice > inv
      : !isBull(seg) && seg.toPrice < inv;
  };

  let candidate = largest(byTime);

  for (let i = 0; i < 20; i++) {
    if (!candidate) break;
    const inv = invLevel(candidate);
    const after = byTime.filter(s => s.fromTime > candidate.toTime);
    if (!after.find(s => crosses(candidate, inv, s))) break; // no invalidation

    const pool = byTime.filter(s => s.fromTime > candidate.toTime);
    if (!pool.length) break;
    const next = largest(pool);
    if (next.fromTime === candidate.fromTime) break;
    candidate = next;
  }

  if (!candidate) return null;

  const bull = isBull(candidate);
  const s    = span(candidate);

  return {
    // Direction
    type:         bull ? "bullish" : "bearish",
    // Price bounds
    high:         bull ? candidate.toPrice   : candidate.fromPrice,
    low:          bull ? candidate.fromPrice : candidate.toPrice,
    // Segment fields (used everywhere for fib)
    fromPrice:    candidate.fromPrice,
    toPrice:      candidate.toPrice,
    toSide:       candidate.toSide,
    fromTime:     candidate.fromTime,
    toTime:       candidate.toTime,
    // Backward compat aliases
    startPrice:   candidate.fromPrice,
    endPrice:     candidate.toPrice,
    startTime:    candidate.fromTime,
    endTime:      candidate.toTime,
    startIndex:   candidate.fromBarIndex,
    endIndex:     candidate.toBarIndex,
    // -0.168 invalidation level
    invalidation: bull
      ? candidate.toPrice + 0.168 * s
      : candidate.toPrice - 0.168 * s,
    span: s,
  };
}

// ─── Fib helpers ──────────────────────────────────────────────────────────────
// price = toPrice + ratio × (fromPrice − toPrice)
// ratio=0 → tip (toPrice), ratio=1 → origin (fromPrice)
function fibPrice(mw, ratio) {
  return mw.toPrice + ratio * (mw.fromPrice - mw.toPrice);
}

function calcTrapZone(mw) {
  const a = fibPrice(mw, -0.236);
  const b = fibPrice(mw,  0.236);
  return {
    high:   Math.max(a, b),
    low:    Math.min(a, b),
    center: (a + b) / 2,
    range:  Math.abs(mw.toPrice - mw.fromPrice),
  };
}

function classifyZone(mw, currentPrice) {
  if (!mw || currentPrice == null) return "trap";
  const waveRange = Math.abs(mw.high - mw.low);
  const tol    = waveRange * 0.05;
  const fib382 = fibPrice(mw, 0.382);
  const fib618 = fibPrice(mw, 0.618);
  if (Math.abs(currentPrice - fib618) <= tol) return "hot618";
  if (Math.abs(currentPrice - fib382) <= tol) return "near382";
  return "trap";
}

module.exports = { detectMotherWave, fibPrice, calcTrapZone, classifyZone, computeSegments };
