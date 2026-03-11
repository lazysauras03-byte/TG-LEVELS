const moment = require("moment");

class SRAnalyzer {
  constructor(options = {}) {
    this.leftBars = options.leftBars || 5;
    this.rightBars = options.rightBars || 5;
    this.clusterThresholdPct = options.clusterThresholdPct || 0.5;
    this.touchThresholdPct = options.touchThresholdPct || 0.3;
    this.volumeSpikeMultiplier = options.volumeSpikeMultiplier || 2;
    this.minZoneCandles = options.minZoneCandles || 6;
    this.maxZoneRangePct = options.maxZoneRangePct || 1.5;
    this.maxLevels = options.maxLevels || 6;
  }

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

    const allCandidates = [
      ...this._periodExtremes(parsed),
      ...this._fractalPivots(parsed),
      ...this._volumeSpikePivots(parsed, avgVol),
      ...this._gapLevels(parsed),
    ];

    const highCandidates = allCandidates.filter((c) => c.type === "high");
    const lowCandidates = allCandidates.filter((c) => c.type === "low");

    const resistanceLevels = this._clusterAndScore(highCandidates, parsed, currentPrice, avgVol, atr);
    const supportLevels = this._clusterAndScore(lowCandidates, parsed, currentPrice, avgVol, atr);

    const supports = supportLevels
      .filter((l) => l.price < currentPrice)
      .sort((a, b) => b.price - a.price)
      .slice(0, this.maxLevels)
      .map((l) => this._formatLevel(l, currentPrice, "support"));

    const resistances = resistanceLevels
      .filter((l) => l.price > currentPrice)
      .sort((a, b) => a.price - b.price)
      .slice(0, this.maxLevels)
      .map((l) => this._formatLevel(l, currentPrice, "resistance"));

    const zones = this._findConsolidationZones(parsed);
    const { accumulation, distribution } = this._classifyZones(zones, currentPrice);

    const nearestSupport = supports[0] || null;
    const nearestResistance = resistances[0] || null;

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
      summary: this._buildSummary(nearestSupport, nearestResistance, accumulation, distribution, currentPrice),
      entryNearSupport,
      entryNearResistance,
      slBelowSupport,
    };
  }

  // ─────────────────────────────────────────────────────────
  // STEP 0 – Period extremes (HIGHEST PRIORITY)
  //
  // Finds the absolute highest HIGHs and lowest LOWs of the entire
  // candle range — these become the dominant S/R lines exactly like
  // the orange horizontal lines drawn in TradingView.
  //
  // topN: how many distinct extreme highs/lows to capture (default 3)
  // so secondary levels (e.g. a recent swing high just below the period
  // high) also appear in the list.
  // ─────────────────────────────────────────────────────────

  _periodExtremes(candles, topN = 3) {
    const candidates = [];

    // ── Top N distinct extreme HIGHs → resistance ──────────────────────────
    const byHigh = [...candles].sort((a, b) => b.high - a.high);
    const usedHighs = [];
    for (const c of byHigh) {
      const tooClose = usedHighs.some((p) => Math.abs(p - c.high) / p <= 0.005);
      if (!tooClose) {
        candidates.push({
          type: "high",
          price: c.high,
          ts: c.ts,
          time: c.time,
          vol: c.vol,
          isPeriodExtreme: true,
        });
        usedHighs.push(c.high);
        if (usedHighs.length >= topN) break;
      }
    }

    // ── Top N distinct extreme LOWs → support ──────────────────────────────
    const byLow = [...candles].sort((a, b) => a.low - b.low);
    const usedLows = [];
    for (const c of byLow) {
      const tooClose = usedLows.some((p) => Math.abs(p - c.low) / p <= 0.005);
      if (!tooClose) {
        candidates.push({
          type: "low",
          price: c.low,
          ts: c.ts,
          time: c.time,
          vol: c.vol,
          isPeriodExtreme: true,
        });
        usedLows.push(c.low);
        if (usedLows.length >= topN) break;
      }
    }

    return candidates;
  }

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

  _fractalPivots(candles) {
    const n = candles.length;
    const L = this.leftBars;
    const R = this.rightBars;
    const pivots = [];

    for (let i = L; i < n - R; i++) {
      const c = candles[i];

      let isHigh = true;
      for (let j = i - L; j <= i + R; j++) {
        if (j === i) continue;
        if (candles[j].high >= c.high) { isHigh = false; break; }
      }
      if (isHigh) {
        pivots.push({ type: "high", price: c.high, ts: c.ts, time: c.time, vol: c.vol, idx: i });
      }

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

  _volumeSpikePivots(candles, avgVol) {
    const pivots = [];
    const threshold = avgVol * this.volumeSpikeMultiplier;
    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      if (c.vol > threshold) {
        pivots.push({ type: "high", price: c.high, ts: c.ts, time: c.time, vol: c.vol, idx: i });
        pivots.push({ type: "low", price: c.low, ts: c.ts, time: c.time, vol: c.vol, idx: i });
      }
    }
    return pivots;
  }

  _gapLevels(candles) {
    const pivots = [];
    for (let i = 1; i < candles.length; i++) {
      const prev = candles[i - 1];
      const curr = candles[i];
      if (curr.open > prev.high) {
        pivots.push({ type: "high", price: prev.high, ts: curr.ts, time: curr.time, vol: curr.vol, idx: i });
        pivots.push({ type: "high", price: curr.open, ts: curr.ts, time: curr.time, vol: curr.vol, idx: i });
      } else if (curr.open < prev.low) {
        pivots.push({ type: "low", price: prev.low, ts: curr.ts, time: curr.time, vol: curr.vol, idx: i });
        pivots.push({ type: "low", price: curr.open, ts: curr.ts, time: curr.time, vol: curr.vol, idx: i });
      }
    }
    return pivots;
  }

  _clusterAndScore(candidates, candles, currentPrice, avgVol, atr) {
    if (candidates.length === 0) return [];

    const sorted = [...candidates].sort((a, b) => a.price - b.price);
    const clusters = [];

    for (const pt of sorted) {
      const existing = clusters.find(
        (cl) => Math.abs(cl.price - pt.price) / cl.price <= this.clusterThresholdPct / 100
      );

      if (existing) {
        const totalVol = existing.totalVol + pt.vol;
        existing.price = totalVol > 0
          ? (existing.price * existing.totalVol + pt.price * pt.vol) / totalVol
          : (existing.price + pt.price) / 2;
        existing.totalVol = totalVol;
        existing.pivotCount += 1;
        if (pt.isPeriodExtreme) existing.isPeriodExtreme = true;
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
          isPeriodExtreme: pt.isPeriodExtreme || false,
        });
      }
    }

    return clusters.map((cl) => {
      const touches = this._countTouches(cl.price, candles);
      const reactionSize = this._avgReactionSize(cl.price, candles, atr);
      let score = this._scoreLevel(cl, touches, reactionSize, avgVol, candles, atr);

      // Period extremes are always STRONG — they represent the absolute
      // high/low of the lookback window and must appear at the top of the list.
      if (cl.isPeriodExtreme) score = Math.max(score, 90);

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
      if (nearLevel && !inZone) { touches++; inZone = true; }
      else if (!nearLevel) { inZone = false; }
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
        totalReaction += Math.abs(candles[i + 1].close - levelPrice);
        count++;
      }
    }
    return count > 0 ? totalReaction / count / atr : 0;
  }

  _scoreLevel(cluster, touches, reactionSize, avgVol, candles, atr) {
    let score = 0;
    score += Math.min(touches, 3) * 10;
    const volRatio = avgVol > 0 ? cluster.maxVol / avgVol : 1;
    score += Math.min(25, Math.round(volRatio * 8));
    const totalCandles = candles.length;
    const candlesAgo = candles.findIndex((c) => c.ts >= cluster.ts);
    const recencyIdx = candlesAgo >= 0 ? totalCandles - candlesAgo : totalCandles;
    score += Math.round(20 * Math.exp(-recencyIdx / 80));
    score += Math.min(15, Math.round((reactionSize || 0) * 5));
    score += this._roundNumberScore(cluster.price);
    return Math.min(100, Math.max(0, score));
  }

  _roundNumberScore(price) {
    const multiples = [1000, 500, 100, 50, 10];
    for (const m of multiples) {
      if (Math.abs(price % m) <= m * 0.005 || Math.abs(price % m - m) <= m * 0.005) {
        if (m >= 500) return 10;
        if (m >= 100) return 8;
        if (m >= 50) return 5;
        if (m >= 10) return 3;
      }
    }
    return 0;
  }

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
      isPeriodExtreme: level.isPeriodExtreme || false,
    };
  }

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
        if (rangePct <= this.maxZoneRangePct) { zoneHigh = testHigh; zoneLow = testLow; j++; }
        else break;
      }
      const length = j - i;
      if (length >= this.minZoneCandles) {
        const midpoint = (zoneHigh + zoneLow) / 2;
        const totalVol = candles.slice(i, j).reduce((s, c) => s + c.vol, 0);
        zones.push({
          startTime: candles[i].time, endTime: candles[j - 1].time,
          startTs: candles[i].ts, endTs: candles[j - 1].ts,
          high: +zoneHigh.toFixed(2), low: +zoneLow.toFixed(2),
          midpoint: +midpoint.toFixed(2),
          rangePct: +(((zoneHigh - zoneLow) / midpoint) * 100).toFixed(2),
          candleCount: length, totalVolume: totalVol,
          avgVolume: +(totalVol / length).toFixed(0),
        });
        i = j;
      } else { i++; }
    }
    return zones;
  }

  _classifyZones(zones, currentPrice) {
    const accumulation = [];
    const distribution = [];
    for (const zone of zones) {
      const aboveCurrentPct = ((currentPrice - zone.midpoint) / currentPrice) * 100;
      const entry = {
        zone: `~${zone.low}–${zone.high}`, low: zone.low, high: zone.high,
        midpoint: zone.midpoint, candleCount: zone.candleCount,
        startTime: zone.startTime, endTime: zone.endTime,
        totalVolume: zone.totalVolume, avgVolume: zone.avgVolume,
        rangePct: zone.rangePct, distanceFromCurrentPct: +aboveCurrentPct.toFixed(2),
      };
      if (aboveCurrentPct > 0.5) accumulation.push(entry);
      else if (aboveCurrentPct < -0.5) distribution.push(entry);
    }
    accumulation.sort((a, b) => b.midpoint - a.midpoint);
    distribution.sort((a, b) => a.midpoint - b.midpoint);
    return { accumulation: accumulation.slice(0, 2), distribution: distribution.slice(0, 2) };
  }

  _buildSummary(nearestSupport, nearestResistance, accumulation, distribution, currentPrice) {
    const lines = [];
    if (nearestSupport) {
      const tag = nearestSupport.isPeriodExtreme ? " 🔵 PERIOD LOW" : "";
      lines.push(`🟢 Support  : ₹${nearestSupport.price} (${nearestSupport.distancePct}% below) [${nearestSupport.strength} · ${nearestSupport.score}/100 · ${nearestSupport.touches} touch${nearestSupport.touches !== 1 ? "es" : ""}]${tag}`);
    }
    if (nearestResistance) {
      const tag = nearestResistance.isPeriodExtreme ? " 🔵 PERIOD HIGH" : "";
      lines.push(`🔴 Resistance: ₹${nearestResistance.price} (${nearestResistance.distancePct}% above) [${nearestResistance.strength} · ${nearestResistance.score}/100 · ${nearestResistance.touches} touch${nearestResistance.touches !== 1 ? "es" : ""}]${tag}`);
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