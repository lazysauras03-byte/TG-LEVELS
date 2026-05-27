/**
 * strategies/s1s2s3Strategy.js
 * ─────────────────────────────────────────────────────────────────
 * Strategy: Motherwave → TrapZone (0.236) → S1 / S2 / S3
 *
 * MOTHERWAVE:
 *   Most recent completed NH→NL or NL→NH swing from signalEngine.
 *
 * TRAP ZONE:
 *   trapHigh = waveEnd + 0.236 × (waveHigh − waveLow)
 *   trapLow  = waveEnd − 0.236 × (waveHigh − waveLow)
 *
 * S1 — Trigger candle:
 *   Red candle, close < EMA9-lows, body inside trap zone.
 *
 * S2 — Confirmation candle:
 *   Green candle after S1, engulfs S1 body, close > S1.open.
 *
 * S3 — Entry signal:
 *   Red candle after S2, close < S1.close  →  found = true
 * ─────────────────────────────────────────────────────────────────
 */

"use strict";

const { runSignalEngine } = require("../signalEngine");

// ─── Motherwave ───────────────────────────────────────────────────────────────
function findMotherwave(candles, signals) {
  if (!signals || signals.length < 2) return null;
  const swings = signals.filter((s) => s.type === "NH" || s.type === "NL");
  if (swings.length < 2) return null;

  const prev = swings[swings.length - 2];
  const last = swings[swings.length - 1];
  if (!candles[prev.barIndex] || !candles[last.barIndex]) return null;

  if (prev.type === "NL" && last.type === "NH") {
    return {
      type: "bullish",
      high: last.price, low: prev.price,
      startTime: prev.time, endTime: last.time,
      startIndex: prev.barIndex, endIndex: last.barIndex,
      startPrice: prev.price, endPrice: last.price,
    };
  }
  if (prev.type === "NH" && last.type === "NL") {
    return {
      type: "bearish",
      high: prev.price, low: last.price,
      startTime: prev.time, endTime: last.time,
      startIndex: prev.barIndex, endIndex: last.barIndex,
      startPrice: prev.price, endPrice: last.price,
    };
  }
  return null;
}

// ─── Trap zone ────────────────────────────────────────────────────────────────
function calcTrapZone(motherwave) {
  const range = motherwave.high - motherwave.low;
  const fib = 0.236 * range;
  const center = motherwave.endPrice;
  return { high: center + fib, low: center - fib, center, range, fib236: fib };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function isRed(c) { return c.close < c.open; }
function isGreen(c) { return c.close >= c.open; }
function isCandleInsideTrap(c, trap) {
  const bodyHigh = Math.max(c.open, c.close);
  const bodyLow = Math.min(c.open, c.close);
  return bodyHigh <= trap.high && bodyLow >= trap.low;
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
      if (isRed(c) && c.close < emaLow && isCandleInsideTrap(c, trapZone)) {
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

    const { signals, emaLows } = runSignalEngine(candles);
    const motherwave = findMotherwave(candles, signals);
    if (!motherwave) return result;

    result.motherwave = motherwave;
    result.patternStage = "motherwave";

    const trapZone = calcTrapZone(motherwave);
    result.trapZone = trapZone;
    result.patternStage = "trapzone";

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