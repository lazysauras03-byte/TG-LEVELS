/**
 * entryMap.js
 * Entry Point Quality Scorer — "Google Map for Entries"
 * Composites all analysis signals into a single entry quality grade.
 */

/**
 * Score entry setup across multiple dimensions.
 *
 * @param {object} opts
 * @param {object} opts.pattern          - from analyzePattern()
 * @param {object} opts.srAnalysis       - from srAnalyzer.analyze()
 * @param {object} opts.dowAnalysis      - from analyzeDowTheory()
 * @param {object} opts.wyckoffAnalysis  - from analyzeWyckoff()
 * @param {object} opts.niftyBias        - from getNiftyBias()
 * @param {object} opts.signalCandle     - the BCVC candle that triggered
 * @param {number} opts.entryPrice
 * @param {number} opts.stopLoss
 * @param {string} opts.direction        - "BULLISH_CROSSOVER" | "BEARISH_CROSSOVER"
 * @returns {object} scoring result
 */
function scoreEntry({ pattern, srAnalysis, dowAnalysis, wyckoffAnalysis,waveAnalysis, niftyBias, signalCandle, entryPrice, stopLoss, direction }) {
  const isBullish = direction === "BULLISH_CROSSOVER";
  const breakdown = { sr: 0, dow: 0, wyckoff: 0, bcvc: 0, span: 0, nifty: 0, volume: 0, rr: 0 ,wave: 0};

  // ── S/R Alignment (20 pts) ────────────────────────────────────────────────
  if (srAnalysis && !srAnalysis.error) {
    if (isBullish) {
      if (srAnalysis.entryNearSupport)   breakdown.sr += 10;
      if (srAnalysis.slBelowSupport)     breakdown.sr += 5;
      // No resistance within 1× risk above entry
      const risk = Math.abs(entryPrice - stopLoss);
      const nearestR = srAnalysis.resistance && srAnalysis.resistance[0];
      if (!nearestR || nearestR.price > entryPrice + risk) breakdown.sr += 5;
    } else {
      if (srAnalysis.entryNearResistance) breakdown.sr += 10;
      // SL above resistance (entry near resistance, SL is above → SL above resistance)
      const nearestR = srAnalysis.resistance && srAnalysis.resistance[0];
      if (nearestR && stopLoss > nearestR.price) breakdown.sr += 5;
      // No support within 1× risk below entry
      const risk = Math.abs(entryPrice - stopLoss);
      const nearestS = srAnalysis.support && srAnalysis.support[0];
      if (!nearestS || nearestS.price < entryPrice - risk) breakdown.sr += 5;
    }
  }

  // ── Dow Theory (15 pts) ───────────────────────────────────────────────────
  if (dowAnalysis) {
    if (dowAnalysis.alignment === "ALIGNED")        breakdown.dow = 15;
    else if (dowAnalysis.alignment === "NEUTRAL")   breakdown.dow = 7;
    else                                            breakdown.dow = 0;
  }

  // ── Wyckoff Phase (15 pts) ────────────────────────────────────────────────
  if (wyckoffAnalysis && wyckoffAnalysis.phase !== "UNKNOWN") {
    const { phase, events } = wyckoffAnalysis;
    const hasSpring   = events && events.some((e) => e.type === "SPRING");
    const hasUpthrust = events && events.some((e) => e.type === "UPTHRUST");

    if (isBullish) {
      if (phase === "ACCUMULATION" || phase === "MARKUP") {
        breakdown.wyckoff = 15;
      } else if (phase === "RANGING") {
        breakdown.wyckoff = 5;
      } else {
        breakdown.wyckoff = 0;
      }
    } else {
      if (phase === "DISTRIBUTION" || phase === "MARKDOWN") {
        breakdown.wyckoff = 15;
      } else if (phase === "RANGING") {
        breakdown.wyckoff = 5;
      } else {
        breakdown.wyckoff = 0;
      }
    }
  }

    if (waveAnalysis && waveAnalysis.structure !== 'UNKNOWN') {
    if (isBullish && waveAnalysis.structure === 'HH_HL') breakdown.wave = 5;
    else if (!isBullish && waveAnalysis.structure === 'LH_LL') breakdown.wave = 5;
    else if (waveAnalysis.structure === 'MIXED' || waveAnalysis.structure === 'HH_LL') breakdown.wave = 2;
    else breakdown.wave = 0;
  }

  // ── BCVC Quality (15 pts) ─────────────────────────────────────────────────
  if (signalCandle) {
    const volumeRatio = parseFloat(signalCandle.volumeRatio) || 0;
    const rangeRatio  = parseFloat(signalCandle.rangeRatio)  || 0;
    if (volumeRatio > 2)   breakdown.bcvc += 10;
    else if (volumeRatio > 1.5) breakdown.bcvc += 6;
    else if (volumeRatio > 1.2) breakdown.bcvc += 3;
    if (rangeRatio > 1.5)  breakdown.bcvc += 5;
    else if (rangeRatio > 1.2) breakdown.bcvc += 3;
  }

  // ── Candle Span (10 pts) ──────────────────────────────────────────────────
  const span = pattern && pattern.candlesBetween ? pattern.candlesBetween : 999;
  if      (span <= 10) breakdown.span = 10;
  else if (span <= 15) breakdown.span = 7;
  else if (span <= 20) breakdown.span = 4;
  else                 breakdown.span = 0;

  // ── Nifty Bias (10 pts) ───────────────────────────────────────────────────
  if (niftyBias) {
    const nBias = niftyBias.bias;
    if      (isBullish && nBias === "LONG")   breakdown.nifty = 10;
    else if (!isBullish && nBias === "SHORT")  breakdown.nifty = 10;
    else if (nBias === "CHOPPY")               breakdown.nifty = 5;
    else                                       breakdown.nifty = 0;
  }

  // ── Volume Confirmation (10 pts) ──────────────────────────────────────────
  const volumeRatio = signalCandle ? (parseFloat(signalCandle.volumeRatio) || 0) : 0;
  if      (volumeRatio > 2.0)  breakdown.volume = 10;
  else if (volumeRatio >= 1.5) breakdown.volume = 7;
  else if (volumeRatio >= 1.25) breakdown.volume = 4;
  else                          breakdown.volume = 0;

  // ── Risk/Reward (5 pts) ───────────────────────────────────────────────────
  if (entryPrice && stopLoss) {
    const riskPct = (Math.abs(entryPrice - stopLoss) / entryPrice) * 100;
    if      (riskPct < 1) breakdown.rr = 5;
    else if (riskPct <= 2) breakdown.rr = 3;
    else                   breakdown.rr = 0;
  }

  // ── Total + Grade ─────────────────────────────────────────────────────────
  const totalScore = Object.values(breakdown).reduce((a, b) => a + b, 0);

  let grade, stars, roadType, recommendation;

  if (totalScore >= 80) {
    grade = "A+"; stars = "⭐⭐⭐⭐⭐"; roadType = "Highway";
    recommendation = "Excellent setup — enter with full position size";
  } else if (totalScore >= 65) {
    grade = "A";  stars = "⭐⭐⭐⭐";  roadType = "Main Road";
    recommendation = "Good setup — proceed with standard position size";
  } else if (totalScore >= 50) {
    grade = "B";  stars = "⭐⭐⭐";    roadType = "Side Street";
    recommendation = "Decent setup — use normal position size, manage risk";
  } else if (totalScore >= 35) {
    grade = "C";  stars = "⭐⭐";      roadType = "Dirt Road";
    recommendation = "Weak setup — reduce position size, proceed with caution";
  } else {
    grade = "D";  stars = "⭐";        roadType = "Dead End";
    recommendation = "Poor setup — avoid or use very small size";
  }

  return { totalScore, grade, stars, roadType, breakdown, recommendation };
}

/**
 * Build an HTML-formatted Telegram block for the entry score.
 * @param {object} entryScore - Result from scoreEntry()
 * @returns {string} HTML string for Telegram message
 */
function buildEntryMapTelegramBlock(entryScore) {
  if (!entryScore) return "";

  const { totalScore, grade, stars, roadType, breakdown, recommendation } = entryScore;
  const { sr, dow, wyckoff, bcvc, span, nifty, volume, rr,wave } = breakdown;

  return `🗺️ <b>Entry Quality:</b>
${stars} ${grade} Grade — "${roadType}"
📊 Score   : ${totalScore}/100
📋 SR: ${sr} | Dow: ${dow} | Wyckoff: ${wyckoff} | BCVC: ${bcvc}
   Span: ${span} | Nifty: ${nifty} | Vol: ${volume} |Wave: ${wave} | RR: ${rr}
💡 ${recommendation}`;
}

module.exports = { scoreEntry, buildEntryMapTelegramBlock };
