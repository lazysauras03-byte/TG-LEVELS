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

  // ── Collect full chain: previousWaves (invalidated) + current ────────────
  const previousWaves = [];  // invalidated candidates, oldest first

  while (i < waves.length) {
    const candidate = waves[i];
    const nextWave = waves[i + 1];
    if (!nextWave) break;

    const ratio = sp(candidate) / sp(nextWave);
    if (ratio < 2.5) { i += 1; continue; }

    const inv = invLevel(candidate);
    const breakingWave = waves.slice(i + 1).find(w => breachesFib(candidate, inv, w));
    if (!breakingWave) break;

    // This candidate passed ratio + fib but got breached → previous MW
    previousWaves.push({ seg: candidate, inv });
    i = waves.indexOf(breakingWave);
  }

  const cand = waves[i];
  if (!cand) return null;

  // ── Build wave object from a segment ─────────────────────────────────────
  function buildWave(seg) {
    const iB = bull(seg);
    const sp2 = Math.abs(seg.toPrice - seg.fromPrice);
    return {
      dir: iB ? "bull" : "bear",
      col1Time: seg.fromTime,
      col1Price: seg.fromPrice,
      col2Time: seg.toTime,
      col2Price: seg.toPrice,
      delta: +sp2.toFixed(2),
      waveNum: seg._waveNum,
      label: (seg.prevWaveType && seg.currWaveType)
        ? `${seg.prevWaveType}\u2192${seg.currWaveType}`
        : "—",
      toSide: seg.toSide,
      fromPrice: seg.fromPrice,
      toPrice: seg.toPrice,
      fromTime: seg.fromTime,
      toTime: seg.toTime,
      startIndex: seg.fromBarIndex,
      endIndex: seg.toBarIndex,
    };
  }

  // ── Build fib levels from a segment ──────────────────────────────────────
  function buildFibs(seg) {
    const iB = bull(seg);
    const sp2 = Math.abs(seg.toPrice - seg.fromPrice);
    const o = seg.fromPrice;
    const e = seg.toPrice;
    return iB
      ? {
        "-0.618": e + 0.618 * sp2,
        "0.0": e,
        "0.236": e - 0.236 * sp2,
        "0.382": e - 0.382 * sp2,
        "0.5": e - 0.5 * sp2,
        "0.618": e - 0.618 * sp2,
        "0.786": e - 0.786 * sp2,
        "1.0": o,
      }
      : {
        "1.0": o,
        "0.786": o - 0.214 * sp2,
        "0.618": o - 0.382 * sp2,
        "0.5": o - 0.5 * sp2,
        "0.382": o - 0.618 * sp2,
        "0.236": o - 0.764 * sp2,
        "0.0": e,
        "-0.618": e - 0.618 * sp2,
      };
  }

  // ── Current MW ────────────────────────────────────────────────────────────
  const isBull = bull(cand);
  const span = sp(cand);
  const origin = cand.fromPrice;
  const end = cand.toPrice;

  const wave = buildWave(cand);
  const fibLevels = buildFibs(cand);

  // ── Previous MWs — numbered -1, -2, -3 ... from most recent to oldest ────
  // previousWaves is oldest-first, so reverse for -1 = most recent previous
  const prevChain = previousWaves.slice().reverse().map((item, idx) => {
    const pw = buildWave(item.seg);
    const pFib = buildFibs(item.seg);
    return {
      mwNo: -(idx + 1),          // -1, -2, -3 ...
      wave: pw,
      fibLevels: pFib,
      invalidation: pFib["-0.618"],
    };
  });

  return {
    wave,
    fibLevels,
    invalidation: fibLevels["-0.618"],
    // Full chain — current is mwNo 0, previous are -1, -2, ...
    chain: [
      { mwNo: 0, wave, fibLevels, invalidation: fibLevels["-0.618"] },
      ...prevChain,
    ],
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