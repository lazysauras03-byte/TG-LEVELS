/**
 * motherwave.js
 * ─────────────────────────────────────────────────────────────────
 * Single source of truth for Mother Wave detection.
 *
 * ONE public function: detectMotherWaveForAPI
 *   → Used by scannerRunner.js, /api/motherwave endpoint, everywhere.
 *   → Returns: { wave, fibLevels, invalidation }
 *   → wave.endIndex is included so S1 search knows which bar to start from.
 *
 * All pages (ScannerPage, StrategiesPage, ReportsPage, FibDashboardPage)
 * receive the same shape — no more two-function split.
 *
 * ── ALGORITHM (exact sequential walk) ────────────────────────────
 *
 *   waves = all wave segments sorted chronologically (oldest first)
 *   i = index of the LARGEST wave by delta  ← Step 1: start from biggest
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

// ─── API-ready MW detection — THE ONE PUBLIC FUNCTION ─────────────────────────
//
// Returns: { wave, fibLevels, invalidation }
//
// wave shape:
//   wave.dir          : "bull" | "bear"
//   wave.col1Time     : fromTime  (ms)  — wave origin time
//   wave.col1Price    : fromPrice       — wave origin price
//   wave.col2Time     : toTime    (ms)  — wave tip time
//   wave.col2Price    : toPrice         — wave tip price
//   wave.delta        : abs price span
//   wave.waveNum      : counting label (-1 = latest, -N = oldest)
//   wave.label        : "HH→LH" etc.
//   wave.toSide       : "high" | "low"
//   wave.fromPrice    : same as col1Price (for fib math)
//   wave.toPrice      : same as col2Price (for fib math)
//   wave.fromTime     : same as col1Time
//   wave.toTime       : same as col2Time
//   wave.endIndex     : bar index of wave tip — used by scannerS1.S2.S3 to know
//                       which bar to start S1 search from
//   wave.startIndex   : bar index of wave origin
//
// fibLevels: { "-0.618", "0.0", "0.236", "0.382", "0.5", "0.618", "0.786", "1.0" }
// invalidation: same as fibLevels["-0.618"]
//
function detectMotherWaveForAPI(candles) {
  const segs = computeSegments(candles);
  if (!segs.length) return null;

  // Sort chronologically — oldest first
  const allWaves = [...segs].sort((a, b) => a.fromTime - b.fromTime);

  // Cap to last MAX_WAVES=50 segments (matches WavesIndicator.js frontend)
  const MAX_WAVES = 50;
  const waves = allWaves.slice(-MAX_WAVES);

  // Assign waveNum: -N for oldest, -1 for newest
  const total = waves.length;
  waves.forEach((w, i) => { w._waveNum = -(total - i); });

  const sp = s => Math.abs(s.toPrice - s.fromPrice);
  const bull = s => s.toSide === "high";

  const invLevel = s => bull(s)
    ? s.toPrice + 0.618 * sp(s)
    : s.toPrice - 0.618 * sp(s);

  const breachesFib = (candidate, inv, seg) => {
    if (seg.fromTime <= candidate.toTime) return false;
    if (bull(candidate)) {
      if (bull(seg) && seg.toPrice > inv) return true;
      if (!bull(seg) && seg.toPrice < candidate.fromPrice) return true;
    } else {
      if (!bull(seg) && seg.toPrice < inv) return true;
      if (bull(seg) && seg.toPrice > candidate.fromPrice) return true;
    }
    return false;
  };

  // Step 1: Start from the largest wave by delta (not the oldest)
  let largestIdx = 0;
  let largestDelta = 0;
  for (let k = 0; k < waves.length; k++) {
    const d = sp(waves[k]);
    if (d > largestDelta) { largestDelta = d; largestIdx = k; }
  }
  let i = largestIdx;

  while (i < waves.length) {
    const candidate = waves[i];
    const nextWave = waves[i + 1];
    if (!nextWave) break;

    const ratio = sp(candidate) / sp(nextWave);
    if (ratio < 2.5) { i += 1; continue; }

    const inv = invLevel(candidate);
    const breakingWave = waves.slice(i + 1).find(w => breachesFib(candidate, inv, w));
    if (!breakingWave) break;
    i = waves.indexOf(breakingWave);
  }

  const cand = waves[i];
  if (!cand) return null;

  const isBull = bull(cand);
  const span = sp(cand);
  const origin = cand.fromPrice;
  const end = cand.toPrice;

  // ── Wave row (matches ReportsPage buildTableRows shape) ─────────────────
  const wave = {
    dir: isBull ? "bull" : "bear",
    col1Time: cand.fromTime,
    col1Price: cand.fromPrice,
    col2Time: cand.toTime,
    col2Price: cand.toPrice,
    delta: +span.toFixed(2),
    waveNum: cand._waveNum,
    label: (cand.prevWaveType && cand.currWaveType)
      ? `${cand.prevWaveType}\u2192${cand.currWaveType}`
      : "—",
    toSide: cand.toSide,
    // Flat fields for fib math (same as old detectMotherWave shape)
    fromPrice: cand.fromPrice,
    toPrice: cand.toPrice,
    fromTime: cand.fromTime,
    toTime: cand.toTime,
    startIndex: cand.fromBarIndex,
    endIndex: cand.toBarIndex,   // ← used by scannerS1.S2.S3 for S1 search start
  };

  // ── Fib levels ──────────────────────────────────────────────────────────
  const fibLevels = isBull
    ? {
      "-0.618": end + 0.618 * span,
      "0.0": end,
      "0.236": end - 0.236 * span,
      "0.382": end - 0.382 * span,
      "0.5": end - 0.5 * span,
      "0.618": end - 0.618 * span,
      "0.786": end - 0.786 * span,
      "1.0": origin,
    }
    : {
      "1.0": origin,
      "0.786": origin - 0.214 * span,
      "0.618": origin - 0.382 * span,
      "0.5": origin - 0.5 * span,
      "0.382": origin - 0.618 * span,
      "0.236": origin - 0.764 * span,
      "0.0": end,
      "-0.618": end - 0.618 * span,
    };

  return {
    wave,
    fibLevels,
    invalidation: fibLevels["-0.618"],
  };
}

// ─── Fib helpers (still exported for any router that needs them) ──────────────
function fibPrice(mw, ratio) {
  // mw can be the full { wave, fibLevels } object OR a raw wave object
  const w = mw.wave || mw;
  const to = w.toPrice ?? w.endPrice;
  const from = w.fromPrice ?? w.startPrice;
  return to + ratio * (from - to);
}

function calcTrapZone(mw) {
  const w = mw.wave || mw;
  const tip = fibPrice(w, 0);
  const ret = fibPrice(w, 0.236);
  return {
    high: Math.max(tip, ret),
    low: Math.min(tip, ret),
    center: (tip + ret) / 2,
    range: Math.abs(w.toPrice - w.fromPrice),
  };
}

function classifyZone(mw, currentPrice) {
  const w = mw.wave || mw;
  if (!w || currentPrice == null) return "other";
  const span = Math.abs(w.fromPrice - w.toPrice);
  const tol = span * 0.05;

  if (Math.abs(currentPrice - fibPrice(w, 0.618)) <= tol) return "hot618";
  if (Math.abs(currentPrice - fibPrice(w, 0.382)) <= tol) return "near382";

  const tip = fibPrice(w, 0);
  const ret = fibPrice(w, 0.236);
  const trapHigh = Math.max(tip, ret);
  const trapLow = Math.min(tip, ret);
  if (currentPrice >= trapLow && currentPrice <= trapHigh) return "trap";

  return "other";
}

module.exports = {
  detectMotherWaveForAPI,   // ← THE one function everything uses
  fibPrice,
  calcTrapZone,
  classifyZone,
  computeSegments,
};