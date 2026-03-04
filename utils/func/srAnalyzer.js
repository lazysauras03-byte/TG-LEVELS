// srAnalyzer.js
// Professional-grade Support/Resistance detection for 15-min candle data.
// Multi-method pivot detection with volume weighting, strength scoring, and polarity flips.

const moment = require("moment");

class SRAnalyzer {
  constructor(options = {}) {
    // Fractal pivot bars on each side (stronger signal than the old 3)
    this.leftBars = options.leftBars || 5;
    this.rightBars = options.rightBars || 5;

    // Cluster merge threshold (% of price)
    this.clusterThresholdPct = options.clusterThresholdPct || 0.5;

    // Touch detection: price comes within this % of level and reverses
    this.touchThresholdPct = options.touchThresholdPct || 0.3;

    // Volume-spike multiplier: candle volume > N × 20-period avg
    this.volumeSpikeMultiplier = options.volumeSpikeMultiplier || 2;

    // Consolidation zone parameters
    this.minZoneCandles = options.minZoneCandles || 6;
    this.maxZoneRangePct = options.maxZoneRangePct || 1.5;

    // How many top S/R levels to return
    this.maxLevels = options.maxLevels || 4;
  }

  // ─────────────────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────────────────

  /**
   * Main entry point.
   * @param {Array} candles  - raw fyers candle arrays [ts, open, high, low, close, vol]
   * @param {number} currentPrice
   * @returns {Object} { support, resistance, accumulation, distribution, currentPrice, summary }
   */
  analyze(candles, currentPrice) {
    if (!candles || candles.length < 20) {
      return { error: "Not enough candles for SR analysis" };
    }

    const parsed = candles.map((c) => ({
      ts: c[0],
      time: moment.unix(c[0]).format("YYYY-MM-DD HH:mm"),
      open: parseFloat(c[1]),
      high: parseFloat(c[2]),
      low: parseFloat(c[3]),
      close: parseFloat(c[4]),
      vol: parseFloat(c[5]) || 0,
      range: parseFloat(c[2]) - parseFloat(c[3]),
    }));

    const avgVol = this._avgVolume(parsed);
    const atr = this._calcATR(parsed, 14);

    // Collect candidate levels from multiple methods
    const candidates = [
      ...this._fractalPivots(parsed),
      ...this._volumeSpikePivots(parsed, avgVol),
      ...this._gapLevels(parsed),
    ];

    // Cluster candidates → scored levels
    const allLevels = this._clusterAndScore(candidates, parsed, currentPrice, avgVol, atr);

    // Polarity flip: broken supports become resistance and vice-versa
    const flippedLevels = this._detectPolarityFlips(allLevels, parsed);
    const allWithFlipped = [...allLevels, ...flippedLevels];

    // Separate into supports / resistances
    // Flipped levels go to their new role (flippedFrom:'support' → resistance, flippedFrom:'resistance' → support)
    const supports = allWithFlipped
      .filter((l) => {
        if (l.flippedFrom === "support")     return false; // was support, now resistance — skip for supports
        if (l.flippedFrom === "resistance")  return l.price < currentPrice; // was resistance, now support
        return l.price < currentPrice;
      })
      .sort((a, b) => b.price - a.price)
      .slice(0, this.maxLevels)
      .map((l) => this._formatLevel(l, currentPrice, "support"));

    const resistances = allWithFlipped
      .filter((l) => {
        if (l.flippedFrom === "resistance")  return false; // was resistance, now support — skip for resistances
        if (l.flippedFrom === "support")     return l.price > currentPrice; // was support, now resistance
        return l.price > currentPrice;
      })
      .sort((a, b) => a.price - b.price)
      .slice(0, this.maxLevels)
      .map((l) => this._formatLevel(l, currentPrice, "resistance"));

    // Consolidation zones
    const zones = this._findConsolidationZones(parsed);
    const { accumulation, distribution } = this._classifyZones(zones, currentPrice);

    const nearestSupport = supports[0] || null;
    const nearestResistance = resistances[0] || null;

    // Entry quality helpers
    const entryNearSupport =
      nearestSupport !== null &&
      Math.abs((currentPrice - nearestSupport.price) / currentPrice) <= 0.01;
    const entryNearResistance =
      nearestResistance !== null &&
      Math.abs((nearestResistance.price - currentPrice) / currentPrice) <= 0.01;
    const slBelowSupport =
      nearestSupport !== null && currentPrice > nearestSupport.price;

    return {
      support: supports,
      resistance: resistances,
      accumulation,
      distribution,
      currentPrice,
      summary: this._buildSummary(
        nearestSupport,
        nearestResistance,
        accumulation,
        distribution,
        currentPrice
      ),
      // Entry quality helpers consumed by entryMap
      entryNearSupport,
      entryNearResistance,
      slBelowSupport,
    };
  }

  // ─────────────────────────────────────────────────────────
  // HELPERS: ATR and average volume
  // ─────────────────────────────────────────────────────────

  _avgVolume(candles, period = 20) {
    const vols = candles.map((c) => c.vol).filter((v) => v > 0);
    if (vols.length === 0) return 1;
    const slice = vols.slice(-period);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  }

  _calcATR(candles, period = 14) {
    if (candles.length < 2) return 1;
    const trs = [];
    for (let i = 1; i < candles.length; i++) {
      const hl = candles[i].high - candles[i].low;
      const hc = Math.abs(candles[i].high - candles[i - 1].close);
      const lc = Math.abs(candles[i].low - candles[i - 1].close);
      trs.push(Math.max(hl, hc, lc));
    }
    const slice = trs.slice(-period);
    return slice.reduce((a, b) => a + b, 0) / slice.length || 1;
  }

  // ─────────────────────────────────────────────────────────
  // STEP 1a – Fractal pivots (left=5, right=5)
  // ─────────────────────────────────────────────────────────

  _fractalPivots(candles) {
    const n = candles.length;
    const L = this.leftBars;
    const R = this.rightBars;
    const pivots = [];

    for (let i = L; i < n - R; i++) {
      const c = candles[i];

      // Fractal HIGH
      let isHigh = true;
      for (let j = i - L; j <= i + R; j++) {
        if (j === i) continue;
        if (candles[j].high >= c.high) { isHigh = false; break; }
      }
      if (isHigh) {
        pivots.push({ type: "high", price: c.high, ts: c.ts, time: c.time, vol: c.vol, idx: i });
      }

      // Fractal LOW
      let isLow = true;
      for (let j = i - L; j <= i + R; j++) {
        if (j === i) continue;
        if (candles[j].low <= c.low) { isLow = false; break; }
      }
      if (isLow) {
        pivots.push({ type: "low", price: c.low, ts: c.ts, time: c.time, vol: c.vol, idx: i });
      }
    }

    return pivots;
  }

  // ─────────────────────────────────────────────────────────
  // STEP 1b – Volume-spike pivots (vol > 2× 20-period avg)
  // ─────────────────────────────────────────────────────────

  _volumeSpikePivots(candles, avgVol) {
    const pivots = [];
    const threshold = avgVol * this.volumeSpikeMultiplier;

    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      if (c.vol > threshold) {
        pivots.push({ type: "high", price: c.high, ts: c.ts, time: c.time, vol: c.vol, idx: i });
        pivots.push({ type: "low",  price: c.low,  ts: c.ts, time: c.time, vol: c.vol, idx: i });
      }
    }

    return pivots;
  }

  // ─────────────────────────────────────────────────────────
  // STEP 1c – Gap levels (open gaps above prev high or below prev low)
  // ─────────────────────────────────────────────────────────

  _gapLevels(candles) {
    const pivots = [];

    for (let i = 1; i < candles.length; i++) {
      const prev = candles[i - 1];
      const curr = candles[i];

      if (curr.open > prev.high) {
        // Gap up — prev high and curr open are S/R candidates
        pivots.push({ type: "high", price: prev.high, ts: curr.ts, time: curr.time, vol: curr.vol, idx: i });
        pivots.push({ type: "low",  price: curr.open, ts: curr.ts, time: curr.time, vol: curr.vol, idx: i });
      } else if (curr.open < prev.low) {
        // Gap down — prev low and curr open are S/R candidates
        pivots.push({ type: "low",  price: prev.low,  ts: curr.ts, time: curr.time, vol: curr.vol, idx: i });
        pivots.push({ type: "high", price: curr.open, ts: curr.ts, time: curr.time, vol: curr.vol, idx: i });
      }
    }

    return pivots;
  }

  // ─────────────────────────────────────────────────────────
  // STEP 2 – Cluster with volume weighting + strength scoring
  // ─────────────────────────────────────────────────────────

  _clusterAndScore(candidates, candles, currentPrice, avgVol, atr) {
    if (candidates.length === 0) return [];

    const sorted = [...candidates].sort((a, b) => a.price - b.price);
    const clusters = [];

    for (const pt of sorted) {
      const existing = clusters.find(
        (cl) => Math.abs(cl.price - pt.price) / cl.price <= this.clusterThresholdPct / 100
      );

      if (existing) {
        // Volume-weighted merge
        const totalVol = existing.totalVol + pt.vol;
        existing.price = totalVol > 0
          ? (existing.price * existing.totalVol + pt.price * pt.vol) / totalVol
          : (existing.price + pt.price) / 2;
        existing.totalVol = totalVol;
        existing.pivotCount += 1;
        if (pt.ts > existing.ts) { existing.ts = pt.ts; existing.time = pt.time; }
        if (pt.ts < existing.firstTs) existing.firstTs = pt.ts;
        existing.maxVol = Math.max(existing.maxVol, pt.vol);
      } else {
        clusters.push({
          price: pt.price,
          totalVol: pt.vol,
          maxVol: pt.vol,
          pivotCount: 1,
          ts: pt.ts,
          firstTs: pt.ts,
          time: pt.time,
        });
      }
    }

    // Count touches and measure reaction size
    return clusters.map((cl) => {
      const touches = this._countTouches(cl.price, candles);
      const reactionSize = this._avgReactionSize(cl.price, candles, atr);
      const score = this._scoreLevel(cl, touches, reactionSize, avgVol, candles, atr);
      const strength = score >= 70 ? "STRONG" : score >= 40 ? "MODERATE" : "WEAK";
      return { ...cl, touches, reactionSize, score, strength };
    });
  }

  _countTouches(levelPrice, candles) {
    const thresh = levelPrice * (this.touchThresholdPct / 100);
    let touches = 0;
    let inZone = false;

    for (const c of candles) {
      const nearLevel = c.low <= levelPrice + thresh && c.high >= levelPrice - thresh;
      if (nearLevel && !inZone) {
        touches++;
        inZone = true;
      } else if (!nearLevel) {
        inZone = false;
      }
    }

    return Math.max(touches, 1);
  }

  _avgReactionSize(levelPrice, candles, atr) {
    const thresh = levelPrice * (this.touchThresholdPct / 100);
    let totalReaction = 0;
    let count = 0;

    for (let i = 0; i < candles.length - 1; i++) {
      const c = candles[i];
      const nearLevel = c.low <= levelPrice + thresh && c.high >= levelPrice - thresh;
      if (nearLevel) {
        // Measure next candle move away from level
        const nextC = candles[i + 1];
        const reaction = Math.abs(nextC.close - levelPrice);
        totalReaction += reaction;
        count++;
      }
    }

    return count > 0 ? totalReaction / count / atr : 0;
  }

  _scoreLevel(cluster, touches, reactionSize, avgVol, candles, atr) {
    let score = 0;

    // Touches (max 30 pts): 10 per touch, capped at 3
    score += Math.min(touches, 3) * 10;

    // Volume weight (max 25 pts)
    const volRatio = avgVol > 0 ? cluster.maxVol / avgVol : 1;
    score += Math.min(25, Math.round(volRatio * 8));

    // Recency (max 20 pts): exponential decay
    const totalCandles = candles.length;
    const candlesAgo = candles.findIndex((c) => c.ts >= cluster.ts);
    const recencyIdx = candlesAgo >= 0 ? totalCandles - candlesAgo : totalCandles;
    const recencyScore = Math.round(20 * Math.exp(-recencyIdx / 80));
    score += recencyScore;

    // Reaction size (max 15 pts)
    score += Math.min(15, Math.round((reactionSize || 0) * 5));

    // Round number proximity (max 10 pts)
    score += this._roundNumberScore(cluster.price);

    return Math.min(100, Math.max(0, score));
  }

  _roundNumberScore(price) {
    const multiples = [1000, 500, 100, 50, 10];
    for (const m of multiples) {
      if (Math.abs(price % m) <= m * 0.005 || Math.abs(price % m - m) <= m * 0.005) {
        if (m >= 500) return 10;
        if (m >= 100) return 8;
        if (m >= 50)  return 5;
        if (m >= 10)  return 3;
      }
    }
    return 0;
  }

  _strengthFromScore(score) {
    return score >= 70 ? "STRONG" : score >= 40 ? "MODERATE" : "WEAK";
  }

  // ─────────────────────────────────────────────────────────
  // STEP 3 – Polarity flip detection
  // ─────────────────────────────────────────────────────────

  _detectPolarityFlips(levels, candles) {
    const flipped = [];
    if (candles.length < 2) return flipped;

    for (const level of levels) {
      // Find candle where price broke through this level convincingly (close > 0.5% away)
      let brokeBelow = false;
      let brokeAbove = false;

      for (const c of candles) {
        if (c.ts <= level.ts) continue; // only after level formation
        if (c.close < level.price * 0.995) { brokeBelow = true; break; }
        if (c.close > level.price * 1.005) { brokeAbove = true; break; }
      }

      if (brokeBelow) {
        // Support broke → becomes resistance candidate
        const adjustedScore = Math.round(level.score * 0.8);
        flipped.push({
          ...level,
          score: adjustedScore,
          strength: this._strengthFromScore(adjustedScore),
          flippedFrom: "support",
        });
      } else if (brokeAbove) {
        // Resistance broke → becomes support candidate
        const adjustedScore = Math.round(level.score * 0.8);
        flipped.push({
          ...level,
          score: adjustedScore,
          strength: this._strengthFromScore(adjustedScore),
          flippedFrom: "resistance",
        });
      }
    }

    return flipped;
  }

  // ─────────────────────────────────────────────────────────
  // STEP 4 – Format a level for output
  // ─────────────────────────────────────────────────────────

  _formatLevel(level, currentPrice, role) {
    const distancePct =
      role === "support"
        ? +(((currentPrice - level.price) / currentPrice) * 100).toFixed(2)
        : +(((level.price - currentPrice) / currentPrice) * 100).toFixed(2);

    return {
      price: +level.price.toFixed(2),
      score: level.score,
      strength: level.strength,
      touches: level.touches,
      time: level.time,
      distancePct,
      flippedFrom: level.flippedFrom || null,
    };
  }

  // ─────────────────────────────────────────────────────────
  // STEP 5 – Consolidation zones
  // ─────────────────────────────────────────────────────────

  _findConsolidationZones(candles) {
    const zones = [];
    const n = candles.length;
    let i = 0;

    while (i < n) {
      let j = i + 1;
      let zoneHigh = candles[i].high;
      let zoneLow = candles[i].low;

      while (j < n) {
        const testHigh = Math.max(zoneHigh, candles[j].high);
        const testLow = Math.min(zoneLow, candles[j].low);
        const midpoint = (testHigh + testLow) / 2;
        const rangePct = ((testHigh - testLow) / midpoint) * 100;

        if (rangePct <= this.maxZoneRangePct) {
          zoneHigh = testHigh;
          zoneLow = testLow;
          j++;
        } else {
          break;
        }
      }

      const length = j - i;
      if (length >= this.minZoneCandles) {
        const midpoint = (zoneHigh + zoneLow) / 2;
        const totalVol = candles.slice(i, j).reduce((s, c) => s + c.vol, 0);

        zones.push({
          startTime: candles[i].time,
          endTime: candles[j - 1].time,
          startTs: candles[i].ts,
          endTs: candles[j - 1].ts,
          high: +zoneHigh.toFixed(2),
          low: +zoneLow.toFixed(2),
          midpoint: +midpoint.toFixed(2),
          rangePct: +(((zoneHigh - zoneLow) / midpoint) * 100).toFixed(2),
          candleCount: length,
          totalVolume: totalVol,
          avgVolume: +(totalVol / length).toFixed(0),
        });
        i = j;
      } else {
        i++;
      }
    }

    return zones;
  }

  // ─────────────────────────────────────────────────────────
  // STEP 6 – Classify zones as Accumulation or Distribution
  // ─────────────────────────────────────────────────────────

  _classifyZones(zones, currentPrice) {
    const accumulation = [];
    const distribution = [];

    for (const zone of zones) {
      const aboveCurrentPct = ((currentPrice - zone.midpoint) / currentPrice) * 100;
      const zoneLabel = `~${zone.low}–${zone.high}`;

      const entry = {
        zone: zoneLabel,
        low: zone.low,
        high: zone.high,
        midpoint: zone.midpoint,
        candleCount: zone.candleCount,
        startTime: zone.startTime,
        endTime: zone.endTime,
        totalVolume: zone.totalVolume,
        avgVolume: zone.avgVolume,
        rangePct: zone.rangePct,
        distanceFromCurrentPct: +aboveCurrentPct.toFixed(2),
      };

      if (aboveCurrentPct > 0.5) {
        accumulation.push(entry);
      } else if (aboveCurrentPct < -0.5) {
        distribution.push(entry);
      }
    }

    accumulation.sort((a, b) => b.midpoint - a.midpoint);
    distribution.sort((a, b) => a.midpoint - b.midpoint);

    return {
      accumulation: accumulation.slice(0, 2),
      distribution: distribution.slice(0, 2),
    };
  }

  // ─────────────────────────────────────────────────────────
  // STEP 7 – Human-readable summary
  // ─────────────────────────────────────────────────────────

  _buildSummary(nearestSupport, nearestResistance, accumulation, distribution, currentPrice) {
    const lines = [];

    if (nearestSupport) {
      lines.push(
        `🟢 Support  : ₹${nearestSupport.price} (${nearestSupport.distancePct}% below) [${nearestSupport.strength} · ${nearestSupport.score}/100 · ${nearestSupport.touches} touch${nearestSupport.touches !== 1 ? "es" : ""}]`
      );
    }
    if (nearestResistance) {
      lines.push(
        `🔴 Resistance: ₹${nearestResistance.price} (${nearestResistance.distancePct}% above) [${nearestResistance.strength} · ${nearestResistance.score}/100 · ${nearestResistance.touches} touch${nearestResistance.touches !== 1 ? "es" : ""}]`
      );
    }
    if (accumulation.length) {
      const a = accumulation[0];
      lines.push(`📦 Accum Zone: ₹${a.low}–₹${a.high} (${a.candleCount} candles)`);
    }
    if (distribution.length) {
      const d = distribution[0];
      lines.push(`📤 Dist Zone : ₹${d.low}–₹${d.high} (${d.candleCount} candles)`);
    }

    return lines.join("\n");
  }
}

module.exports = SRAnalyzer;