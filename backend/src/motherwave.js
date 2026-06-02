/**
 * motherwave.js
 * ─────────────────────────────────────────────────────────────────
 * Single source of truth for Mother Wave detection.
 * Used by scannerRunner.js — computed ONCE per symbol per scan,
 * then passed into every strategy via scan(symbol, candles, context).
 *
 * Strategies never recompute the mother wave themselves.
 *
 * ── ALGORITHM (exact sequential walk) ────────────────────────────
 *
 *   waves = all wave segments sorted chronologically (oldest first)
 *   i = 0
 *
 *   while i < waves.length:
 *     candidate = waves[i]
 *     nextWave  = waves[i + 1]   ← the IMMEDIATELY next wave in time
 *
 *     if no nextWave → candidate is MW (nothing challenged it)
 *
 *     RATIO CHECK:
 *       candidate.delta / nextWave.delta >= 2.5 ?
 *         FAIL → i++, continue   (move to very next wave, not largest)
 *         PASS → check fib invalidation against ALL waves after candidate
 *
 *     FIB INVALIDATION:
 *       BULL MW inv = toPrice + 0.618 × span  (above tip)
 *       BEAR MW inv = toPrice − 0.618 × span  (below tip)
 *       Invalidated when subsequent wave:
 *         BULL: BULL wave HIGH > inv   OR  BEAR wave LOW < origin (fromPrice)
 *         BEAR: BEAR wave LOW  < inv   OR  BULL wave HIGH > origin (fromPrice)
 *
 *       No breach → MW confirmed
 *       Breach found:
 *         i = index of the breaking wave
 *         continue (restart from that wave)
 *
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
//
// Implements the exact sequential walk algorithm:
//   i=0 → candidate=waves[i], nextWave=waves[i+1]
//   ratio fail → i++ (next wave, no skipping)
//   ratio pass → check fib invalidation across ALL waves after candidate
//     no breach → MW confirmed
//     breach     → i = index of breaking wave, restart
//
function detectMotherWave(candles) {
  const segs = computeSegments(candles);
  if (!segs.length) return null;

  // Sort chronologically — oldest first
  const waves = [...segs].sort((a, b) => a.fromTime - b.fromTime);

  const span = s => Math.abs(s.toPrice - s.fromPrice);
  const isBull = s => s.toSide === "high";

  // -0.618 invalidation level beyond the tip
  const invLevel = s => isBull(s)
    ? s.toPrice + 0.618 * span(s)   // above HIGH tip
    : s.toPrice - 0.618 * span(s);  // below LOW tip

  // Returns true if `seg` breaches the candidate's fib bounds
  const breachesFib = (candidate, inv, seg) => {
    if (seg.fromTime <= candidate.toTime) return false;
    if (isBull(candidate)) {
      if (isBull(seg) && seg.toPrice > inv) return true; // -0.618 breach
      if (!isBull(seg) && seg.toPrice < candidate.fromPrice) return true; // origin breach
    } else {
      if (!isBull(seg) && seg.toPrice < inv) return true; // -0.618 breach
      if (isBull(seg) && seg.toPrice > candidate.fromPrice) return true; // origin breach
    }
    return false;
  };

  let i = 0;

  while (i < waves.length) {
    const candidate = waves[i];
    const nextWave = waves[i + 1]; // immediately next chronological wave

    // No next wave → nothing challenged the candidate → MW confirmed
    if (!nextWave) break;

    // ── Ratio check: candidate.delta / nextWave.delta >= 2.5 ─────────────
    const ratio = span(candidate) / span(nextWave);
    if (ratio < 2.5) {
      // FAIL — move one step forward (not to largest, just +1)
      i += 1;
      continue;
    }

    // ── Ratio passed — check fib invalidation across all waves after candidate
    const inv = invLevel(candidate);
    const breakingWave = waves.slice(i + 1).find(w => breachesFib(candidate, inv, w));

    if (!breakingWave) break; // No breach → MW confirmed

    // Invalidated — restart from the breaking wave
    const breakIdx = waves.indexOf(breakingWave);
    i = breakIdx;
  }

  const candidate = waves[i];
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
  const tip = fibPrice(mw, 0);
  const ret = fibPrice(mw, 0.236);
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

  if (Math.abs(currentPrice - fibPrice(mw, 0.618)) <= tol) return "hot618";
  if (Math.abs(currentPrice - fibPrice(mw, 0.382)) <= tol) return "near382";

  const tip = fibPrice(mw, 0);
  const ret = fibPrice(mw, 0.236);
  const trapHigh = Math.max(tip, ret);
  const trapLow = Math.min(tip, ret);
  if (currentPrice >= trapLow && currentPrice <= trapHigh) return "trap";

  return "other";
}

module.exports = { detectMotherWave, fibPrice, calcTrapZone, classifyZone, computeSegments };