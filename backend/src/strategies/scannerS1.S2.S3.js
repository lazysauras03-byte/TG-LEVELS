/**
 * strategies/scannerS1.S2.S3.js
 * ─────────────────────────────────────────────────────────────────
 * Strategy: Motherwave → TrapZone (0.236) → S1 / S2 / S3
 *
 * MOTHERWAVE:
 *   Uses the SAME EMA-touch wave algorithm as WavesIndicator.js on the
 *   frontend.  Picks the LARGEST completed segment by absolute price delta
 *   — identical to getLastMotherwave() in FibDashboardPage.js.
 *
 * FIB LEVELS (matching FibDashboardPage.js computeFibLevels):
 *   price(ratio) = toPrice + ratio × (fromPrice − toPrice)
 *   where toPrice = wave TIP (ratio 0), fromPrice = wave ORIGIN (ratio 1).
 *
 * TRAP ZONE  (FibDashboard definition — NOT ±0.236×range around endPrice):
 *   trapHigh = price(−0.236)  — whichever of the two is higher
 *   trapLow  = price(+0.236)  — whichever is lower
 *   i.e. the band between the −0.236 and +0.236 fib levels.
 *
 * ZONE SEGREGATION (matching getZoneTray in ScannerPage):
 *   near382  : |lastClose − fib(0.382)| ≤ 5% of wave range
 *   hot618   : |lastClose − fib(0.618)| ≤ 5% of wave range
 *   trap     : everything else
 *
 * S1 — Trigger candle (after motherwave end):
 *   Red candle, close < EMA9-lows, body overlaps trap zone.
 *
 * S2 — Confirmation:
 *   Green candle, engulfs S1 body, close > S1.open.
 *
 * S3 — Entry signal:
 *   Red candle after S2, close < S1.close → found = true
 * ─────────────────────────────────────────────────────────────────
 */

"use strict";

// ─── EMA helper (matches WavesIndicator.js calcEMA) ──────────────────────────
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

// ─── Wave detection — exact port of updateWavesIndicatorPure ─────────────────
// Returns segments array where each segment has:
//   { fromBarIndex, fromPrice, toBarIndex, toPrice, toSide, fromTime, toTime }
// toSide = "high"  → bullish wave (origin=low → tip=high)
// toSide = "low"   → bearish wave (origin=high → tip=low)
function computeWaveSegments(candles) {
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
      if (bestPrice === null || c.high > bestPrice) { bestPrice = c.high; bestBar = i; }
      if (touchHigh) legTouchedEMA = true;
      if (touchLow && legTouchedEMA) {
        const lp = bestPrice, lb = bestBar;
        currWaveType = prevHigh === null ? "HH" : lp > prevHigh ? "HH" : "LH";
        prevHigh = lp;
        if (lastPrice !== null) {
          segments.push({
            fromBarIndex: lastBar, fromPrice: lastPrice,
            toBarIndex: lb, toPrice: lp,
            toSide: "high",
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
      if (bestPrice === null || c.low < bestPrice) { bestPrice = c.low; bestBar = i; }
      if (touchLow) legTouchedEMA = true;
      if (touchHigh && legTouchedEMA) {
        const lp = bestPrice, lb = bestBar;
        currWaveType = prevLow === null ? "LL" : lp < prevLow ? "LL" : "HL";
        prevLow = lp;
        if (lastPrice !== null) {
          segments.push({
            fromBarIndex: lastBar, fromPrice: lastPrice,
            toBarIndex: lb, toPrice: lp,
            toSide: "low",
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

// ─── Motherwave — LARGEST segment by absolute delta (= getLastMotherwave) ─────
function findMotherwave(candles) {
  const segments = computeWaveSegments(candles);
  if (!segments.length) return null;

  const best = segments.reduce((acc, seg) => {
    const d = Math.abs(seg.toPrice - seg.fromPrice);
    const bd = Math.abs(acc.toPrice - acc.fromPrice);
    return d > bd ? seg : acc;
  }, segments[0]);

  const isBull = best.toSide === "high"; // tip is a high → bullish
  return {
    // public fields used by ScannerPage / buildChartUrl
    type: isBull ? "bullish" : "bearish",
    high: isBull ? best.toPrice : best.fromPrice,
    low: isBull ? best.fromPrice : best.toPrice,
    startTime: best.fromTime,   // wave ORIGIN time
    endTime: best.toTime,     // wave TIP   time
    startPrice: best.fromPrice,  // wave ORIGIN price
    endPrice: best.toPrice,    // wave TIP   price
    startIndex: best.fromBarIndex,
    endIndex: best.toBarIndex,
    // keep segment fields for fib calculation
    fromPrice: best.fromPrice,
    toPrice: best.toPrice,
    toSide: best.toSide,
    fromTime: best.fromTime,
    toTime: best.toTime,
  };
}

// ─── Fib price (matches FibDashboardPage computeFibLevels) ────────────────────
// price(ratio) = toPrice + ratio × (fromPrice − toPrice)
// ratio=0 → tip (toPrice), ratio=1 → origin (fromPrice)
function fibPrice(mw, ratio) {
  return mw.toPrice + ratio * (mw.fromPrice - mw.toPrice);
}

// ─── Trap zone (matches FibDashboard definition) ──────────────────────────────
// Trap zone = band between fib(-0.236) and fib(+0.236)
function calcTrapZone(mw) {
  const a = fibPrice(mw, -0.236);
  const b = fibPrice(mw, 0.236);
  const high = Math.max(a, b);
  const low = Math.min(a, b);
  const range = Math.abs(mw.toPrice - mw.fromPrice);
  const center = (high + low) / 2;
  return { high, low, center, range };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function isRed(c) { return c.close < c.open; }
function isGreen(c) { return c.close >= c.open; }
function isCandleOverlapsTrap(c, trap) {
  const bodyHigh = Math.max(c.open, c.close);
  const bodyLow = Math.min(c.open, c.close);
  return bodyHigh >= trap.low && bodyLow <= trap.high;
}

// ─── S1 / S2 / S3 ────────────────────────────────────────────────────────────
function findS1S2S3(candles, emaLows, trapZone, motherwaveEndIndex) {
  const startIdx = motherwaveEndIndex + 1;
  if (startIdx >= candles.length) return { s1: null, s2: null, s3: null };

  let s1 = null, s2 = null, s3 = null;

  for (let i = startIdx; i < candles.length; i++) {
    const c = candles[i];
    const emaLow = emaLows[i];

    if (!s1) {
      if (isRed(c) && c.close < emaLow && isCandleOverlapsTrap(c, trapZone)) {
        s1 = { ...c, index: i, emaLow };
      }
      continue;
    }

    if (!s2) {
      if (isGreen(c) && c.open <= s1.close && c.close > s1.open) {
        s2 = { ...c, index: i };
      } else if (isRed(c) && c.close < s1.close) {
        s1 = null; s2 = null; // invalidate, restart
      }
      continue;
    }

    if (!s3) {
      if (isRed(c) && c.close < s1.close) {
        s3 = { ...c, index: i };
        break;
      }
      if (isGreen(c) && c.close > s2.high) {
        s1 = null; s2 = null; s3 = null; // setup broken
      }
    }
  }

  return { s1, s2, s3 };
}

// ─── Strategy interface ───────────────────────────────────────────────────────
function scan(symbol, candles) {
  const result = {
    symbol,
    found: false,
    patternStage: "none",
    motherwave: null,
    trapZone: null,
    s1: null, s2: null, s3: null,
    lastCandle: candles.length > 0 ? candles[candles.length - 1] : null,
    candleCount: candles.length,
    scannedAt: new Date().toISOString(),
    error: null,
  };

  try {
    if (!candles || candles.length < 20) { result.error = "insufficient_data"; return result; }

    const motherwave = findMotherwave(candles);
    if (!motherwave) return result;

    result.motherwave = motherwave;
    result.patternStage = "motherwave";

    const trapZone = calcTrapZone(motherwave);
    result.trapZone = trapZone;
    result.patternStage = "trapzone";

    // Need emaLows for S1 detection — recompute from candles
    const emaLows = calcEMA(candles.map(c => c.low), 9);
    const { s1, s2, s3 } = findS1S2S3(candles, emaLows, trapZone, motherwave.endIndex);
    result.s1 = s1; result.s2 = s2; result.s3 = s3;

    if (s1) result.patternStage = "s1";
    if (s2) result.patternStage = "s2";
    if (s3) { result.patternStage = "s3_complete"; result.found = true; }
  } catch (err) {
    result.error = err.message;
  }

  return result;
}

module.exports = {
  id: "s1s2s3",
  name: "Motherwave S1/S2/S3",
  description: "Identifies motherwave, plots 0.236 trap zone, then finds S1→S2→S3 candle pattern",
  scan,
};