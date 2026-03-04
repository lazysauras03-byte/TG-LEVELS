/**
 * waveAnalysis.js
 * Wave Analysis using 20-period SMA on 15-min candle data.
 *
 * A "wave" is a contiguous price swing defined by which side of the 20 SMA
 * the close is on:
 *   - BULLISH wave  → close ≥ 20 SMA (upswing)
 *   - BEARISH wave  → close <  20 SMA (downswing)
 *
 * Wave transitions (SMA crossings) are used to:
 *   1. Mark wave high / low at each transition
 *   2. Compare successive wave highs → HH or LH?
 *   3. Compare successive wave lows  → HL or LL?
 *   4. Classify overall structure: HH+HL, LH+LL, or Mixed
 *
 * Candle format: [timestamp, open, high, low, close, volume]
 */

const SMA_PERIOD = 20; // period for the reference SMA
const MIN_WAVE_CANDLES = 3; // minimum candles to qualify as a valid wave
const WAVES_TO_ANALYZE = 6; // how many completed waves to use for structure

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1 — Calculate 20-period SMA (close-based)
// Returns array aligned with `candles`; null for the first SMA_PERIOD-1 slots.
// ─────────────────────────────────────────────────────────────────────────────
function calcSMA(candles, period) {
  const sma = new Array(candles.length).fill(null);
  let windowSum = 0;

  for (let i = 0; i < candles.length; i++) {
    windowSum += parseFloat(candles[i][4]); // add close
    if (i >= period) {
      windowSum -= parseFloat(candles[i - period][4]); // drop oldest
    }
    if (i >= period - 1) {
      sma[i] = windowSum / period;
    }
  }

  return sma;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 — Detect waves by tracking SMA side changes
// Each wave records its HIGH and LOW (full candle shadow, not just closes).
// ─────────────────────────────────────────────────────────────────────────────
function detectWaves(candles, sma) {
  const waves = [];
  let waveStart = -1;
  let currentSide = null; // 'above' | 'below'
  let runHigh = -Infinity;
  let runLow = +Infinity;

  const finaliseWave = (endIdx) => {
    if (waveStart < 0 || endIdx - waveStart + 1 < MIN_WAVE_CANDLES) return;
    waves.push({
      type: currentSide === "above" ? "BULLISH" : "BEARISH",
      startIdx: waveStart,
      endIdx,
      startTs: candles[waveStart][0],
      endTs: candles[endIdx][0],
      waveHigh: +runHigh.toFixed(2),
      waveLow: +runLow.toFixed(2),
      candleCount: endIdx - waveStart + 1,
      isActive: false,
    });
  };

  for (let i = SMA_PERIOD - 1; i < candles.length; i++) {
    const smaVal = sma[i];
    if (smaVal === null) continue;

    const close = parseFloat(candles[i][4]);
    const high = parseFloat(candles[i][2]);
    const low = parseFloat(candles[i][3]);
    const side = close >= smaVal ? "above" : "below";

    if (currentSide === null) {
      // Initialise first wave
      currentSide = side;
      waveStart = i;
      runHigh = high;
      runLow = low;
      continue;
    }

    if (side !== currentSide) {
      // SMA crossing → close current wave
      finaliseWave(i - 1);
      currentSide = side;
      waveStart = i;
      runHigh = high;
      runLow = low;
    } else {
      // Same wave — extend range
      if (high > runHigh) runHigh = high;
      if (low < runLow) runLow = low;
    }
  }

  // Add the ACTIVE (still-forming) wave — always at least 1 candle
  if (currentSide !== null && waveStart >= 0) {
    const lastIdx = candles.length - 1;
    waves.push({
      type: currentSide === "above" ? "BULLISH" : "BEARISH",
      startIdx: waveStart,
      endIdx: lastIdx,
      startTs: candles[waveStart][0],
      endTs: candles[lastIdx][0],
      waveHigh: +runHigh.toFixed(2),
      waveLow: +runLow.toFixed(2),
      candleCount: lastIdx - waveStart + 1,
      isActive: true,
    });
  }

  return waves;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3 — Classify wave structure from completed waves
// Uses: bullish wave highs → HH/LH, bearish wave lows → HL/LL
// ─────────────────────────────────────────────────────────────────────────────
function classifyStructure(completedWaves) {
  if (completedWaves.length < 2) {
    return { structure: "INSUFFICIENT_DATA", label: "Insufficient data" };
  }

  const recent = completedWaves.slice(-WAVES_TO_ANALYZE);

  const bullWaves = recent.filter((w) => w.type === "BULLISH");
  const bearWaves = recent.filter((w) => w.type === "BEARISH");

  let hhCount = 0,
    lhCount = 0; // bullish wave highs
  let hlCount = 0,
    llCount = 0; // bearish  wave lows

  for (let i = 1; i < bullWaves.length; i++) {
    if (bullWaves[i].waveHigh > bullWaves[i - 1].waveHigh) hhCount++;
    else lhCount++;
  }

  for (let i = 1; i < bearWaves.length; i++) {
    if (bearWaves[i].waveLow < bearWaves[i - 1].waveLow) llCount++;
    else hlCount++;
  }

  const bullishScore = hhCount + hlCount;
  const bearishScore = lhCount + llCount;

  // Strict bullish: HH on ups AND HL on pullbacks
  if (hhCount > lhCount && hlCount > llCount && hhCount > 0 && hlCount > 0) {
    return {
      structure: "HH_HL",
      label: "HH + HL (Bullish)",
      hhCount,
      hlCount,
      lhCount,
      llCount,
    };
  }
  // Strict bearish: LH on rallies AND LL on drops
  if (lhCount > hhCount && llCount > hlCount && lhCount > 0 && llCount > 0) {
    return {
      structure: "LH_LL",
      label: "LH + LL (Bearish)",
      hhCount,
      hlCount,
      lhCount,
      llCount,
    };
  }
  // Transitioning or mixed
  if (hhCount > 0 && llCount > 0 && hhCount >= lhCount) {
    return {
      structure: "HH_LL",
      label: "HH + LL (Mixed — watch for breakout)",
      hhCount,
      hlCount,
      lhCount,
      llCount,
    };
  }
  if (lhCount > 0 && hlCount > 0 && lhCount >= hhCount) {
    return {
      structure: "LH_HL",
      label: "LH + HL (Mixed — consolidating)",
      hhCount,
      hlCount,
      lhCount,
      llCount,
    };
  }

  return {
    structure: "MIXED",
    label: "Mixed (No clear bias)",
    hhCount,
    hlCount,
    lhCount,
    llCount,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 4 — Determine wave number within current swing direction
// e.g., if we're in the 3rd bullish wave → "Upswing #3"
// ─────────────────────────────────────────────────────────────────────────────
function currentWaveNumber(waves, activeWave) {
  if (!activeWave) return 1;
  // Count how many consecutive waves of the same type end the list
  // (we reset count when the direction alternates)
  let count = 0;
  for (let i = waves.length - 1; i >= 0; i--) {
    if (waves[i].type === activeWave.type) count++;
    else break; // direction changed — stop
  }
  return count;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN — analyzeWaves()
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {Array} rawCandles - [timestamp, open, high, low, close, volume]
 * @returns {object} wave analysis result
 */
function analyzeWaves(rawCandles) {
  const unknown = {
    structure: "UNKNOWN",
    structureLabel: "Unknown",
    currentWave: null,
    lastWaveHigh: null,
    lastWaveLow: null,
    currentSMA: null,
    currentClose: null,
    priceVsSMA: "UNKNOWN",
    waveCount: 0,
    waves: [],
  };

  if (!rawCandles || rawCandles.length < SMA_PERIOD + MIN_WAVE_CANDLES) {
    return unknown;
  }

  const sma = calcSMA(rawCandles, SMA_PERIOD);
  const waves = detectWaves(rawCandles, sma);

  if (waves.length === 0) return unknown;

  const completedWaves = waves.filter((w) => !w.isActive);
  const activeWave = waves.find((w) => w.isActive) || null;

  // Last completed highs / lows from each direction
  const lastBullWave = [...completedWaves]
    .reverse()
    .find((w) => w.type === "BULLISH");
  const lastBearWave = [...completedWaves]
    .reverse()
    .find((w) => w.type === "BEARISH");

  const lastWaveHigh = lastBullWave
    ? lastBullWave.waveHigh
    : completedWaves.length
      ? completedWaves[completedWaves.length - 1].waveHigh
      : null;
  const lastWaveLow = lastBearWave
    ? lastBearWave.waveLow
    : completedWaves.length
      ? completedWaves[completedWaves.length - 1].waveLow
      : null;

  const lastIdx = rawCandles.length - 1;
  const currentClose = +parseFloat(rawCandles[lastIdx][4]).toFixed(2);
  const currentSMA = sma[lastIdx] !== null ? +sma[lastIdx].toFixed(2) : null;
  const priceVsSMA =
    currentSMA !== null
      ? currentClose >= currentSMA
        ? "ABOVE"
        : "BELOW"
      : "UNKNOWN";

  const {
    structure,
    label: structureLabel,
    hhCount,
    hlCount,
    lhCount,
    llCount,
  } = classifyStructure(completedWaves);

  const waveNum = currentWaveNumber(waves, activeWave);

  return {
    structure,
    structureLabel,
    currentWave: activeWave
      ? {
          type: activeWave.type,
          number: waveNum,
          waveHigh: activeWave.waveHigh,
          waveLow: activeWave.waveLow,
          candleCount: activeWave.candleCount,
        }
      : null,
    lastWaveHigh: lastWaveHigh !== null ? +lastWaveHigh.toFixed(2) : null,
    lastWaveLow: lastWaveLow !== null ? +lastWaveLow.toFixed(2) : null,
    currentSMA,
    currentClose,
    priceVsSMA,
    waveCount: completedWaves.length,
    structureDetail: { hhCount, hlCount, lhCount, llCount },
    waves: completedWaves.slice(-8), // last 8 completed waves for reference
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// TELEGRAM BLOCK
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build an HTML-formatted Telegram block for wave analysis.
 * @param {object} waveAnalysis - Result from analyzeWaves()
 * @returns {string} HTML string
 */
function buildWaveAnalysisTelegramBlock(waveAnalysis) {
  if (!waveAnalysis || waveAnalysis.structure === "UNKNOWN") return "";

  const {
    structure,
    structureLabel,
    currentWave,
    lastWaveHigh,
    lastWaveLow,
    currentSMA,
    currentClose,
    priceVsSMA,
    waveCount,
  } = waveAnalysis;

  const structureEmoji =
    structure === "HH_HL" ? "📈" : structure === "LH_LL" ? "📉" : "↔️";

  const smaEmoji =
    priceVsSMA === "ABOVE" ? "🟢" : priceVsSMA === "BELOW" ? "🔴" : "⚪";
  const waveEmoji = currentWave?.type === "BULLISH" ? "🔺" : "🔻";

  const waveLabel = currentWave
    ? `${currentWave.type === "BULLISH" ? "Upswing" : "Downswing"} #${currentWave.number} (${currentWave.candleCount} bars)`
    : "N/A";

  const shLine = lastWaveHigh !== null ? `₹${lastWaveHigh}` : "N/A";
  const slLine = lastWaveLow !== null ? `₹${lastWaveLow}` : "N/A";
  const smaStr = currentSMA !== null ? `₹${currentSMA}` : "N/A";

  return `🌊 <b>Wave Analysis (20 SMA):</b>
${structureEmoji} Structure : ${structureLabel} (${waveCount} waves)
🔺 Last Wave High : ${shLine}
🔻 Last Wave Low  : ${slLine}
${smaEmoji} Price vs SMA  : ${priceVsSMA === "ABOVE" ? "Above" : "Below"} (₹${currentClose} / SMA ${smaStr})
${waveEmoji} Current Wave  : ${waveLabel}`;
}

module.exports = { analyzeWaves, buildWaveAnalysisTelegramBlock };
