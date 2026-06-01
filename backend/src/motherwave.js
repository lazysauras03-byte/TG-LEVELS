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
 *   2. 2.5x Ratio Rule: MW span / CW span >= 2.5
 *      CW = largest opposite-direction segment after MW ends.
 *      No opposite segment → pass (no counter-move yet).
 *   3. -0.618 fib invalidation:
 *      BULL: inv = toPrice + 0.618 × span  (above end HIGH)
 *      BEAR: inv = toPrice - 0.618 × span  (below end LOW)
 *      Also invalidated if opposite wave crosses the 1.0 origin.
 *   4. If fails either check → largest from pool after candidate → repeat.
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
  const eL = calcEMA(candles.map(c => c.low), 9);

  let state = 0, bestPrice = null, bestBar = null, legTouchedEMA = false;
  let lastPrice = null, lastBar = null, prevWaveType = "";
  let prevHigh = null, prevLow = null, currWaveType = "";
  const segments = [];

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const emaH = eH[i], emaL = eL[i];
    if (emaH == null || emaL == null) continue;

    const isGreen = c.close > c.open;
    const isRed = c.close < c.open;
    const touchHigh = (isGreen && c.close > emaH) || (isRed && c.open > emaH);
    const touchLow = (isGreen && c.open < emaL) || (isRed && c.close < emaL);

    if (state === 0) {
      if (touchHigh) { state = 1; bestPrice = c.high; bestBar = i; legTouchedEMA = true; }
      else if (touchLow) { state = -1; bestPrice = c.low; bestBar = i; legTouchedEMA = true; }
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

  const byTime = [...segs].sort((a, b) => a.fromTime - b.fromTime);
  const span = s => Math.abs(s.toPrice - s.fromPrice);
  const isBull = s => s.toSide === "high";
  const largest = pool => pool.reduce((b, s) => span(s) > span(b) ? s : b, pool[0]);

  // -0.618 extension level (beyond the tip, away from origin)
  // BULL: above the HIGH tip  → toPrice + 0.618 * span
  // BEAR: below the LOW tip   → toPrice - 0.618 * span
  const invLevel = s => isBull(s)
    ? s.toPrice + 0.618 * span(s)
    : s.toPrice - 0.618 * span(s);

  // Two invalidation conditions — either one negates the candidate:
  //   1. -0.618 breach: a subsequent same-direction segment blows past the extension level
  //   2. fib(1) / origin breach: a subsequent opposite-direction segment crosses the wave origin
  const crosses = (candidate, inv, seg) => {
    if (seg.fromTime <= candidate.toTime) return false;
    if (isBull(candidate)) {
      if (isBull(seg) && seg.toPrice > inv) return true;
      if (!isBull(seg) && seg.toPrice < candidate.fromPrice) return true;
      return false;
    } else {
      if (!isBull(seg) && seg.toPrice < inv) return true;
      if (isBull(seg) && seg.toPrice > candidate.fromPrice) return true;
      return false;
    }
  };

  // 2.5x Ratio Rule: MW span / CW span >= 2.5
  // CW = largest opposite-direction segment starting after MW ends
  // No opposite segment found → pass (no counter-move yet)
  const passes25x = (candidate) => {
    const after = byTime.filter(s => s.fromTime > candidate.toTime);
    const opposite = after.filter(s => isBull(s) !== isBull(candidate));
    if (!opposite.length) return true;
    const cw = opposite.reduce((b, s) => span(s) > span(b) ? s : b, opposite[0]);
    return span(candidate) / span(cw) >= 2.5;
  };

  let candidate = largest(byTime);

  for (let i = 0; i < 20; i++) {
    if (!candidate) break;

    // Step 1: 2.5x ratio check
    if (!passes25x(candidate)) {
      const pool = byTime.filter(s => s.fromTime > candidate.toTime);
      if (!pool.length) break;
      const next = largest(pool);
      if (next.fromTime === candidate.fromTime) break;
      candidate = next;
      continue;
    }

    // Step 2: Fib invalidation check (-0.618 or 1.0 origin breach)
    const inv = invLevel(candidate);
    const after = byTime.filter(s => s.fromTime > candidate.toTime);
    if (!after.find(s => crosses(candidate, inv, s))) break; // confirmed MW

    const pool = byTime.filter(s => s.fromTime > candidate.toTime);
    if (!pool.length) break;
    const next = largest(pool);
    if (next.fromTime === candidate.fromTime) break;
    candidate = next;
  }

  if (!candidate) return null;

  const bull = isBull(candidate);
  const s = span(candidate);

  return {
    // Direction
    type: bull ? "bullish" : "bearish",
    // Price bounds
    high: bull ? candidate.toPrice : candidate.fromPrice,
    low: bull ? candidate.fromPrice : candidate.toPrice,
    // Segment fields (used everywhere for fib)
    fromPrice: candidate.fromPrice,
    toPrice: candidate.toPrice,
    toSide: candidate.toSide,
    fromTime: candidate.fromTime,
    toTime: candidate.toTime,
    // Backward compat aliases
    startPrice: candidate.fromPrice,
    endPrice: candidate.toPrice,
    startTime: candidate.fromTime,
    endTime: candidate.toTime,
    startIndex: candidate.fromBarIndex,
    endIndex: candidate.toBarIndex,
    // -0.618 invalidation level
    invalidation: bull
      ? candidate.toPrice + 0.618 * s
      : candidate.toPrice - 0.618 * s,
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
  // Trap zone = the orange highlighted box on the chart:
  //   fp(0)    = wave tip (toPrice) — the end of the wave
  //   fp(0.236) = first retracement level back INTO the wave
  // This is the same for both bull and bear waves.
  const tip = fibPrice(mw, 0);      // = toPrice
  const ret = fibPrice(mw, 0.236);  // first retracement
  return {
    high: Math.max(tip, ret),
    low: Math.min(tip, ret),
    center: (tip + ret) / 2,
    range: Math.abs(mw.toPrice - mw.fromPrice),
  };
}

function classifyZone(mw, currentPrice) {
  if (!mw || currentPrice == null) return "other";
  const span = Math.abs(mw.fromPrice - mw.toPrice);
  const tol = span * 0.05;

  // NEAR 0.618 — highest priority (HOT zone)
  if (Math.abs(currentPrice - fibPrice(mw, 0.618)) <= tol) return "hot618";

  // NEAR 0.382
  if (Math.abs(currentPrice - fibPrice(mw, 0.382)) <= tol) return "near382";

  // TRAP ZONE: price between fp(0)=wave tip and fp(0.236)
  // This matches the highlighted orange box on the chart.
  const tip = fibPrice(mw, 0);      // wave end / tip
  const ret = fibPrice(mw, 0.236);  // first retracement
  const trapHigh = Math.max(tip, ret);
  const trapLow = Math.min(tip, ret);
  if (currentPrice >= trapLow && currentPrice <= trapHigh) return "trap";

  return "other";
}

module.exports = { detectMotherWave, fibPrice, calcTrapZone, classifyZone, computeSegments };