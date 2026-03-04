/**
 * wyckoff.js
 * Wyckoff Theory Analyzer — detects Wyckoff market phases from 15-min candle data.
 * Candle format: [timestamp, open, high, low, close, volume]
 */

const ANALYSIS_CANDLES = 150;  // how many recent candles to use
const MIN_RANGE_CANDLES = 20;  // minimum candles in a range to qualify
const RANGE_PCT = 3.5;         // max % width for a "trading range"
const SPRING_RECOVERY_BARS = 3;// candles allowed for spring/upthrust recovery

/**
 * Calculate the average volume of an array of candles (raw format).
 */
function avgVolume(candles) {
  const vols = candles.map((c) => parseFloat(c[5]) || 0);
  if (vols.length === 0) return 0;
  return vols.reduce((a, b) => a + b, 0) / vols.length;
}

/**
 * Detect a trading range (consolidation) in a candle slice.
 * Returns { found, rangeHigh, rangeLow, startIdx, endIdx } or null.
 */
function detectTradingRange(candles) {
  if (candles.length < MIN_RANGE_CANDLES) return null;

  // Slide a window and find the longest range that fits within RANGE_PCT
  let bestRange = null;

  for (let start = 0; start <= candles.length - MIN_RANGE_CANDLES; start++) {
    let rHigh = parseFloat(candles[start][2]);
    let rLow = parseFloat(candles[start][3]);

    for (let end = start + 1; end < candles.length; end++) {
      const h = parseFloat(candles[end][2]);
      const l = parseFloat(candles[end][3]);
      const testHigh = Math.max(rHigh, h);
      const testLow = Math.min(rLow, l);
      const mid = (testHigh + testLow) / 2;
      const pct = ((testHigh - testLow) / mid) * 100;

      if (pct <= RANGE_PCT) {
        rHigh = testHigh;
        rLow = testLow;
        const length = end - start + 1;
        if (length >= MIN_RANGE_CANDLES) {
          if (!bestRange || length > bestRange.length) {
            bestRange = { rangeHigh: rHigh, rangeLow: rLow, startIdx: start, endIdx: end, length };
          }
        }
      } else {
        break;
      }
    }
  }

  return bestRange;
}

/**
 * Determine volume trend within a range: DECLINING, INCREASING, or FLAT.
 */
function volumeTrendInRange(candles, startIdx, endIdx) {
  const slice = candles.slice(startIdx, endIdx + 1);
  if (slice.length < 4) return "FLAT";

  const half = Math.floor(slice.length / 2);
  const firstHalfAvg = avgVolume(slice.slice(0, half));
  const secondHalfAvg = avgVolume(slice.slice(half));

  if (firstHalfAvg === 0) return "FLAT";
  const ratio = secondHalfAvg / firstHalfAvg;

  if (ratio < 0.8) return "DECLINING";
  if (ratio > 1.2) return "INCREASING";
  return "FLAT";
}

/**
 * Detect what trend led into the range (UPTREND or DOWNTREND).
 */
function trendBeforeRange(candles, startIdx) {
  const lookback = Math.min(startIdx, 30);
  if (lookback < 5) return "UNKNOWN";

  const preRange = candles.slice(startIdx - lookback, startIdx);
  const opens = preRange.map((c) => parseFloat(c[1]));
  const closes = preRange.map((c) => parseFloat(c[4]));

  const firstClose = closes[0];
  const lastClose = closes[closes.length - 1];
  const change = ((lastClose - firstClose) / firstClose) * 100;

  if (change > 2) return "UPTREND";
  if (change < -2) return "DOWNTREND";
  return "SIDEWAYS";
}

/**
 * Detect Wyckoff-specific events: Spring, Upthrust, SOS, SOW, LPS, LPSY.
 */
function detectWyckoffEvents(candles, rangeHigh, rangeLow, rangeStartIdx, rangeEndIdx, overallAvgVol) {
  const events = [];
  const thresh = (rangeHigh - rangeLow) * 0.1; // 10% of range width as tolerance

  for (let i = rangeStartIdx; i <= Math.min(rangeEndIdx + SPRING_RECOVERY_BARS, candles.length - 1); i++) {
    const c = candles[i];
    const close = parseFloat(c[4]);
    const low = parseFloat(c[3]);
    const high = parseFloat(c[2]);
    const vol = parseFloat(c[5]) || 0;
    const ts = c[0];
    const isHighVol = vol > overallAvgVol * 1.5;

    // Spring: low dips below range bottom, closes back above within SPRING_RECOVERY_BARS
    if (low < rangeLow - thresh && close > rangeLow) {
      events.push({ type: "SPRING", timestamp: ts, price: low });
    }

    // Upthrust: high breaks above range top, closes back below within SPRING_RECOVERY_BARS
    if (high > rangeHigh + thresh && close < rangeHigh) {
      events.push({ type: "UPTHRUST", timestamp: ts, price: high });
    }

    // SOS: strong bullish candle breaking above range with high volume
    if (close > rangeHigh && isHighVol && i > rangeStartIdx + 5) {
      const body = close - parseFloat(c[1]);
      if (body > 0 && body / (rangeHigh - rangeLow) > 0.3) {
        events.push({ type: "SOS", timestamp: ts, price: close });
      }
    }

    // SOW: strong bearish candle breaking below range with high volume
    if (close < rangeLow && isHighVol && i > rangeStartIdx + 5) {
      const body = parseFloat(c[1]) - close;
      if (body > 0 && body / (rangeHigh - rangeLow) > 0.3) {
        events.push({ type: "SOW", timestamp: ts, price: close });
      }
    }
  }

  // LPS: after a SOS, look for a pullback that holds above range low on lower volume
  const sosEvents = events.filter((e) => e.type === "SOS");
  if (sosEvents.length > 0) {
    const lastSOS = sosEvents[sosEvents.length - 1];
    const sosIdx = candles.findIndex((c) => c[0] === lastSOS.timestamp);
    if (sosIdx >= 0 && sosIdx + 3 < candles.length) {
      for (let i = sosIdx + 1; i < Math.min(sosIdx + 10, candles.length); i++) {
        const c = candles[i];
        const close = parseFloat(c[4]);
        const vol = parseFloat(c[5]) || 0;
        if (close > rangeLow && close < rangeHigh && vol < overallAvgVol) {
          events.push({ type: "LPS", timestamp: c[0], price: close });
          break;
        }
      }
    }
  }

  // LPSY: after a SOW, look for a rally that fails below range high on lower volume
  const sowEvents = events.filter((e) => e.type === "SOW");
  if (sowEvents.length > 0) {
    const lastSOW = sowEvents[sowEvents.length - 1];
    const sowIdx = candles.findIndex((c) => c[0] === lastSOW.timestamp);
    if (sowIdx >= 0 && sowIdx + 3 < candles.length) {
      for (let i = sowIdx + 1; i < Math.min(sowIdx + 10, candles.length); i++) {
        const c = candles[i];
        const close = parseFloat(c[4]);
        const vol = parseFloat(c[5]) || 0;
        if (close < rangeHigh && close > rangeLow && vol < overallAvgVol) {
          events.push({ type: "LPSY", timestamp: c[0], price: close });
          break;
        }
      }
    }
  }

  return events;
}

/**
 * Determine the current Wyckoff phase from context.
 */
function determinePhase(trendBefore, volTrend, events, currentPrice, rangeHigh, rangeLow) {
  const hasSpring    = events.some((e) => e.type === "SPRING");
  const hasUpthrust  = events.some((e) => e.type === "UPTHRUST");
  const hasSOS       = events.some((e) => e.type === "SOS");
  const hasSOW       = events.some((e) => e.type === "SOW");

  // Price broke above range → Markup
  if (currentPrice > rangeHigh * 1.01) {
    if (hasSOS || (trendBefore === "DOWNTREND" && hasSpring)) {
      return { phase: "MARKUP", phaseEmoji: "🚀", confidence: hasSOS ? 80 : 60 };
    }
    return { phase: "MARKUP", phaseEmoji: "🚀", confidence: 55 };
  }

  // Price broke below range → Markdown
  if (currentPrice < rangeLow * 0.99) {
    if (hasSOW || (trendBefore === "UPTREND" && hasUpthrust)) {
      return { phase: "MARKDOWN", phaseEmoji: "📉", confidence: hasSOW ? 80 : 60 };
    }
    return { phase: "MARKDOWN", phaseEmoji: "📉", confidence: 55 };
  }

  // Price still within range
  if (trendBefore === "DOWNTREND") {
    // Came down into range — likely Accumulation
    const confidence = (volTrend === "DECLINING" ? 25 : 0) +
                       (hasSpring ? 30 : 0) +
                       (hasSOS ? 20 : 0) +
                       20; // base
    return { phase: "ACCUMULATION", phaseEmoji: "🔋", confidence: Math.min(95, confidence) };
  }

  if (trendBefore === "UPTREND") {
    // Came up into range — likely Distribution
    const confidence = (volTrend === "DECLINING" ? 25 : 0) +
                       (hasUpthrust ? 30 : 0) +
                       (hasSOW ? 20 : 0) +
                       20;
    return { phase: "DISTRIBUTION", phaseEmoji: "🔌", confidence: Math.min(95, confidence) };
  }

  return { phase: "RANGING", phaseEmoji: "↔️", confidence: 40 };
}

/**
 * Main Wyckoff analysis function.
 * @param {Array} rawCandles - Array of [timestamp, open, high, low, close, volume]
 * @returns {object} Wyckoff analysis result
 */
function analyzeWyckoff(rawCandles) {
  const unknown = {
    phase: "UNKNOWN",
    phaseEmoji: "❓",
    events: [],
    rangeHigh: null,
    rangeLow: null,
    rangeWidth: null,
    volumeTrend: "FLAT",
    confidence: 0,
    description: "Insufficient data for Wyckoff analysis",
  };

  if (!rawCandles || rawCandles.length < MIN_RANGE_CANDLES + 10) { // +10 for context before the range
    return unknown;
  }

  // Use last ANALYSIS_CANDLES candles
  const candles = rawCandles.slice(-ANALYSIS_CANDLES);

  const currentPrice = parseFloat(candles[candles.length - 1][4]);
  const overallAvgVol = avgVolume(candles);

  // Find trading range
  const range = detectTradingRange(candles);
  if (!range) {
    // No clear range — determine simple trend
    const change = ((currentPrice - parseFloat(candles[0][4])) / parseFloat(candles[0][4])) * 100;
    if (change > 3) {
      return {
        ...unknown,
        phase: "MARKUP",
        phaseEmoji: "🚀",
        confidence: 45,
        description: "Price trending up — possible Markup phase",
      };
    }
    if (change < -3) {
      return {
        ...unknown,
        phase: "MARKDOWN",
        phaseEmoji: "📉",
        confidence: 45,
        description: "Price trending down — possible Markdown phase",
      };
    }
    return {
      ...unknown,
      phase: "RANGING",
      phaseEmoji: "↔️",
      confidence: 30,
      description: "No clear Wyckoff structure detected",
    };
  }

  const { rangeHigh, rangeLow, startIdx, endIdx } = range;
  const rangeWidth = +(((rangeHigh - rangeLow) / rangeLow) * 100).toFixed(2);

  const volTrend = volumeTrendInRange(candles, startIdx, endIdx);
  const trendBefore = trendBeforeRange(candles, startIdx);

  const events = detectWyckoffEvents(candles, rangeHigh, rangeLow, startIdx, endIdx, overallAvgVol);

  const { phase, phaseEmoji, confidence } = determinePhase(
    trendBefore, volTrend, events, currentPrice, rangeHigh, rangeLow
  );

  const descriptions = {
    ACCUMULATION: "Accumulation — smart money absorbing supply",
    DISTRIBUTION: "Distribution — smart money offloading positions",
    MARKUP: "Markup — price advancing after accumulation",
    MARKDOWN: "Markdown — price declining after distribution",
    RANGING: "Ranging — no dominant Wyckoff phase yet",
    UNKNOWN: "Insufficient data for Wyckoff analysis",
  };

  return {
    phase,
    phaseEmoji,
    events,
    rangeHigh: +rangeHigh.toFixed(2),
    rangeLow: +rangeLow.toFixed(2),
    rangeWidth,
    volumeTrend: volTrend,
    confidence,
    description: descriptions[phase] || "Unknown phase",
  };
}

/**
 * Build an HTML-formatted Telegram block for the Wyckoff analysis.
 * @param {object} wyckoffAnalysis - Result from analyzeWyckoff()
 * @returns {string} HTML string for Telegram message
 */
function buildWyckoffTelegramBlock(wyckoffAnalysis) {
  if (!wyckoffAnalysis || wyckoffAnalysis.phase === "UNKNOWN") return "";

  const { phase, phaseEmoji, events, rangeHigh, rangeLow, volumeTrend, confidence, description } = wyckoffAnalysis;

  const volEmoji = volumeTrend === "DECLINING" ? "📉" : volumeTrend === "INCREASING" ? "📈" : "➡️";

  const keyEvents = events
    .filter((e) => ["SPRING", "UPTHRUST", "SOS", "SOW", "LPS", "LPSY"].includes(e.type))
    .slice(0, 2)
    .map((e) => `${e.type} ₹${parseFloat(e.price).toFixed(2)}`)
    .join(", ");

  const rangeStr = rangeHigh && rangeLow ? `₹${rangeLow} – ₹${rangeHigh}` : "N/A";

  return `🔬 <b>Wyckoff:</b>
${phaseEmoji} Phase   : ${phase.charAt(0) + phase.slice(1).toLowerCase()} (${confidence}% confidence)
${keyEvents ? `📍 Events  : ${keyEvents}` : "📍 Events  : None detected"}
${volEmoji} Volume  : ${volumeTrend.charAt(0) + volumeTrend.slice(1).toLowerCase()} in range
📐 Range   : ${rangeStr}`;
}

module.exports = { analyzeWyckoff, buildWyckoffTelegramBlock };
