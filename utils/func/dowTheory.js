/**
 * Dow Theory Analyzer
 * Analyzes candle data to determine Dow Theory trend structure, phase, and signal alignment.
 * Candle format: [timestamp, open, high, low, close, volume]
 */

const SWING_LOOKBACK = 5; // candles on each side to identify swing highs/lows
const RECENT_CANDLES = 10;        // recent window for volatility/phase analysis
const LONG_TERM_CANDLES = 60;     // longer-term window for range context
const EXPANSION_THRESHOLD = 1.1;  // range expansion factor (recent vs prior)
const CONTRACTION_THRESHOLD = 0.9;// range contraction factor (recent vs prior)
const ACCUMULATION_THRESHOLD = 0.35; // position ratio below which accumulation is possible
const DISTRIBUTION_THRESHOLD = 0.65; // position ratio above which distribution is possible

/**
 * Identify swing highs and swing lows from candle data.
 * A swing high: candle[i].high is the highest in the window [i-lookback .. i+lookback]
 * A swing low : candle[i].low  is the lowest  in the window [i-lookback .. i+lookback]
 */
function findSwingPoints(candles, lookback = SWING_LOOKBACK) {
  const swingHighs = [];
  const swingLows = [];

  for (let i = lookback; i < candles.length - lookback; i++) {
    const high = parseFloat(candles[i][2]);
    const low  = parseFloat(candles[i][3]);

    let isSwingHigh = true;
    let isSwingLow  = true;

    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (parseFloat(candles[j][2]) >= high) isSwingHigh = false;
      if (parseFloat(candles[j][3]) <= low)  isSwingLow  = false;
    }

    if (isSwingHigh) swingHighs.push({ index: i, price: high, timestamp: candles[i][0] });
    if (isSwingLow)  swingLows.push({ index: i, price: low,  timestamp: candles[i][0] });
  }

  return { swingHighs, swingLows };
}

/**
 * Determine primary trend from the last N swing highs and lows.
 * Returns 'UPTREND', 'DOWNTREND', or 'SIDEWAYS'
 */
function classifyTrend(swingHighs, swingLows, points = 3) {
  const recentHighs = swingHighs.slice(-points);
  const recentLows  = swingLows.slice(-points);

  if (recentHighs.length < 2 || recentLows.length < 2) return 'SIDEWAYS';

  // Check Higher Highs
  let higherHighs = true;
  for (let i = 1; i < recentHighs.length; i++) {
    if (recentHighs[i].price <= recentHighs[i - 1].price) { higherHighs = false; break; }
  }

  // Check Higher Lows
  let higherLows = true;
  for (let i = 1; i < recentLows.length; i++) {
    if (recentLows[i].price <= recentLows[i - 1].price) { higherLows = false; break; }
  }

  // Check Lower Highs
  let lowerHighs = true;
  for (let i = 1; i < recentHighs.length; i++) {
    if (recentHighs[i].price >= recentHighs[i - 1].price) { lowerHighs = false; break; }
  }

  // Check Lower Lows
  let lowerLows = true;
  for (let i = 1; i < recentLows.length; i++) {
    if (recentLows[i].price >= recentLows[i - 1].price) { lowerLows = false; break; }
  }

  if (higherHighs && higherLows) return 'UPTREND';
  if (lowerHighs  && lowerLows)  return 'DOWNTREND';
  return 'SIDEWAYS';
}

/**
 * Describe the swing structure label (e.g. "HH + HL", "LH + LL", "Mixed")
 */
function swingStructureLabel(swingHighs, swingLows, points = 3) {
  const recentHighs = swingHighs.slice(-points);
  const recentLows  = swingLows.slice(-points);

  if (recentHighs.length < 2 || recentLows.length < 2) return 'Mixed';

  const hhCount = recentHighs.filter((h, i) => i > 0 && h.price > recentHighs[i - 1].price).length;
  const hlCount = recentLows.filter((l, i)  => i > 0 && l.price > recentLows[i - 1].price).length;
  const lhCount = recentHighs.filter((h, i) => i > 0 && h.price < recentHighs[i - 1].price).length;
  const llCount = recentLows.filter((l, i)  => i > 0 && l.price < recentLows[i - 1].price).length;

  const ups   = hhCount + hlCount;
  const downs = lhCount + llCount;

  if (ups > downs && hhCount > 0 && hlCount > 0)    return 'HH + HL';
  if (downs > ups && lhCount > 0 && llCount > 0)    return 'LH + LL';
  if (hhCount > 0 && llCount > 0)                   return 'HH + LL (Mixed)';
  if (lhCount > 0 && hlCount > 0)                   return 'LH + HL (Mixed)';
  return 'Mixed';
}

/**
 * Determine trend phase based on price position relative to longer-term range
 * and recent volatility (range expansion/contraction).
 */
function classifyPhase(candles, trend) {
  if (candles.length < 20) return 'Unknown';

  const recent     = candles.slice(-RECENT_CANDLES);
  const longerTerm = candles.slice(-LONG_TERM_CANDLES);

  const ltHigh = Math.max(...longerTerm.map(c => parseFloat(c[2])));
  const ltLow  = Math.min(...longerTerm.map(c => parseFloat(c[3])));
  const ltRange = ltHigh - ltLow;
  if (ltRange === 0) return 'Unknown';

  const recentHigh = Math.max(...recent.map(c => parseFloat(c[2])));
  const recentLow  = Math.min(...recent.map(c => parseFloat(c[3])));
  const recentMid  = (recentHigh + recentLow) / 2;

  // Position of recent midpoint within longer-term range (0 = at bottom, 1 = at top)
  const positionRatio = (recentMid - ltLow) / ltRange;

  // Volatility: average candle range over recent 10 vs prior 10 candles
  const prior10     = candles.slice(-RECENT_CANDLES * 2, -RECENT_CANDLES);
  const recentAvgRange = recent.reduce((s, c) => s + (parseFloat(c[2]) - parseFloat(c[3])), 0) / recent.length;
  const priorAvgRange  = prior10.reduce((s, c)  => s + (parseFloat(c[2]) - parseFloat(c[3])), 0) / prior10.length;
  const expanding   = recentAvgRange > priorAvgRange * EXPANSION_THRESHOLD;
  const contracting = recentAvgRange < priorAvgRange * CONTRACTION_THRESHOLD;

  if (trend === 'DOWNTREND' && positionRatio < ACCUMULATION_THRESHOLD && contracting) return 'Accumulation';
  if (trend === 'UPTREND'   && positionRatio > DISTRIBUTION_THRESHOLD && contracting) return 'Distribution';
  if (expanding)                                                      return 'Markup / Public Participation';
  if (trend === 'UPTREND')                                            return 'Markup / Public Participation';
  if (trend === 'DOWNTREND')                                          return 'Markdown';
  return 'Consolidation';
}

/**
 * Main analysis function.
 * @param {Array} rawCandles - Array of [timestamp, open, high, low, close, volume]
 * @param {string} signalDirection - 'BULLISH_CROSSOVER' or 'BEARISH_CROSSOVER'
 * @returns {object} Dow Theory analysis result
 */
function analyzeDowTheory(rawCandles, signalDirection) {
  if (!rawCandles || rawCandles.length < 20) {
    return {
      trend: 'Unknown',
      structure: 'Unknown',
      phase: 'Unknown',
      alignment: 'Unknown',
      lastSwingHigh: null,
      lastSwingLow: null,
    };
  }

  const { swingHighs, swingLows } = findSwingPoints(rawCandles);
  const trend     = classifyTrend(swingHighs, swingLows);
  const structure = swingStructureLabel(swingHighs, swingLows);
  const phase     = classifyPhase(rawCandles, trend);

  const lastSwingHigh = swingHighs.length > 0 ? swingHighs[swingHighs.length - 1].price : null;
  const lastSwingLow  = swingLows.length  > 0 ? swingLows[swingLows.length   - 1].price : null;

  const isBullishSignal = signalDirection === 'BULLISH_CROSSOVER';
  let alignment;
  if (trend === 'SIDEWAYS') {
    alignment = 'NEUTRAL';
  } else if ((isBullishSignal && trend === 'UPTREND') || (!isBullishSignal && trend === 'DOWNTREND')) {
    alignment = 'ALIGNED';
  } else {
    alignment = 'COUNTER_TREND';
  }

  return { trend, structure, phase, alignment, lastSwingHigh, lastSwingLow };
}

/**
 * Build an HTML-formatted Telegram block for the Dow Theory analysis.
 * @param {object} dowAnalysis - Result from analyzeDowTheory()
 * @returns {string} HTML string for Telegram message
 */
function buildDowTheoryTelegramBlock(dowAnalysis) {
  const { trend, structure, phase, alignment, lastSwingHigh, lastSwingLow } = dowAnalysis;

  const trendEmoji  = trend === 'UPTREND' ? '📈' : trend === 'DOWNTREND' ? '📉' : '↔️';
  const trendLabel  = trend === 'UPTREND' ? 'Uptrend' : trend === 'DOWNTREND' ? 'Downtrend' : 'Sideways';

  const alignLine =
    alignment === 'ALIGNED'
      ? '✅ Signal <b>ALIGNED</b> with trend'
      : alignment === 'COUNTER_TREND'
        ? '⚠️ <b>COUNTER-TREND</b> signal — use caution'
        : '↔️ Sideways — no dominant trend';

  const shLine = lastSwingHigh !== null ? `₹${lastSwingHigh.toFixed(2)}` : 'N/A';
  const slLine = lastSwingLow  !== null ? `₹${lastSwingLow.toFixed(2)}`  : 'N/A';

  return `📊 <b>Dow Theory:</b>
${trendEmoji} Trend     : ${trendLabel} (${structure})
🔄 Phase     : ${phase}
${alignLine}
🔝 Last Swing High : ${shLine}
🔻 Last Swing Low  : ${slLine}`;
}

module.exports = { analyzeDowTheory, buildDowTheoryTelegramBlock };
