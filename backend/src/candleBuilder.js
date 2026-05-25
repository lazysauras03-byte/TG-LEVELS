/**
 * candleBuilder.js
 * ─────────────────────────────────────────────────────────────────
 * Converts raw Fyers tick data into 1-minute OHLC candles and
 * derives higher timeframes (3m, 5m, 15m, 1h, 1D) from the 1m base.
 *
 * Rules:
 *   Open  = first tick of the minute
 *   High  = max price seen in that minute
 *   Low   = min price seen in that minute
 *   Close = latest tick price (updates every tick until minute closes)
 *
 * When a minute boundary is crossed:
 *   1. The previous candle is FINALIZED and appended to history.
 *   2. A new "forming" candle begins with the current tick.
 *   3. Subscribers are notified via the `onCandle` / `onTick` callbacks.
 *
 * Multi-timeframe derivation:
 *   Derived candles are built by aggregating completed 1m candles:
 *     3m  → combine 3 completed 1m candles
 *     5m  → combine 5
 *     15m → combine 15
 *     1h  → combine 60
 *     1D  → combine all candles of the same trading day (IST)
 *
 * The "current forming" candle for each higher TF is derived live by
 * aggregating completed 1m candles in the current window PLUS the
 * currently forming 1m candle.
 * ─────────────────────────────────────────────────────────────────
 */

"use strict";

// ── Constants ────────────────────────────────────────────────────
const MARKET_OPEN_HOUR = 9;
const MARKET_OPEN_MIN = 15;
const MARKET_CLOSE_HOUR = 15;
const MARKET_CLOSE_MIN = 30;

// MCX (commodity) opens at 09:00 IST, not 09:15
const MCX_OPEN_HOUR = 9;
const MCX_OPEN_MIN = 0;

/** Returns true if the symbol is an MCX commodity. */
function isMCXSymbol(symbol) {
  if (!symbol) return false;
  return String(symbol).toUpperCase().startsWith("MCX:");
}

// Resolution → number of 1m candles per bar
const TF_MINUTES = {
  1: 1,
  3: 3,
  5: 5,
  15: 15,
  60: 60,
  1440: null,  // "1D" — special: all candles in an IST calendar day
  10080: null, // "1W" — special: all candles in an IST calendar week (Mon–Fri)
};

/**
 * Floor a timestamp (ms) to the start of its IST minute.
 * IST = UTC+5:30 = UTC + 330 minutes
 */
function floorToMinute(tsMs) {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const istMs = tsMs + IST_OFFSET_MS;
  const floored = Math.floor(istMs / 60000) * 60000;
  return floored - IST_OFFSET_MS; // back to UTC-aligned ms for storage
}

/**
 * Return IST date string "YYYY-MM-DD" for a ms timestamp.
 */
function istDateKey(tsMs) {
  return new Date(tsMs + 5.5 * 3600000)
    .toISOString()
    .slice(0, 10);
}

/**
 * Returns true only when the NSE market is currently live (Mon–Fri 09:15–15:30 IST).
 * Used to decide whether the last higher-TF bar group is "still forming" (live)
 * or "already completed" (closed/after-hours/weekend).
 */
function isMarketLiveNow() {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const istMs = Date.now() + IST_OFFSET_MS;
  const d = new Date(istMs);
  const dow = d.getUTCDay(); // 0=Sun, 6=Sat
  if (dow === 0 || dow === 6) return false;
  const istMin = d.getUTCHours() * 60 + d.getUTCMinutes();
  return istMin >= (9 * 60 + 15) && istMin < (15 * 60 + 30);
}

// ── CandleBuilder class ──────────────────────────────────────────
class CandleBuilder {
  /**
   * @param {object} opts
   * @param {Function} opts.onTick     - called on every tick with (formingCandles)
   *                                     where formingCandles = { <res>: candle }
   * @param {Function} opts.onFinalize - called when a 1m candle closes with
   *                                     (finalizedCandle, formingCandles)
   */
  constructor({ onTick, onFinalize, symbol } = {}) {
    this.onTick = onTick || (() => { });
    this.onFinalize = onFinalize || (() => { });
    this._symbol = symbol || null;

    // Completed 1m candle history (oldest first)
    this._oneMinHistory = [];

    // Currently forming 1m candle (or null before first tick)
    this._forming1m = null;
  }

  // ── Public API ────────────────────────────────────────────────

  /**
   * Seed historical 1m candles from REST API.
   * Must be called BEFORE the first tick arrives to ensure seamless merge.
   *
   * @param {Array<{time, open, high, low, close, volume}>} candles - oldest first
   */
  seedHistory(candles) {
    if (!candles || candles.length === 0) return;
    // Accept only closed candles. A REST candle is "still forming" only if
    // its minute equals the CURRENT minute AND it's less than 30s into that
    // minute (i.e. Fyers returned an in-progress candle). If we're already
    // >30s into the current minute the REST candle is effectively closed and
    // must be kept — otherwise we lose the 9:15 candle when the server starts
    // during 9:16, creating a visible gap in the chart.
    const nowMs = Date.now();
    const nowMinute = floorToMinute(nowMs);
    const secsIntoCurrentMinute = (nowMs - (nowMinute + 5.5 * 3600 * 1000 - 5.5 * 3600 * 1000)) / 1000;
    // Simple rule: keep any candle whose floored minute is strictly before now,
    // OR whose floored minute equals now but we're >45s into the minute
    // (meaning Fyers already has a complete bar for it).
    const msIntoMinute = nowMs % 60000;
    this._oneMinHistory = candles.filter((c) => {
      const candleMinute = floorToMinute(c.time);
      if (candleMinute < nowMinute) return true;          // clearly closed
      if (candleMinute === nowMinute && msIntoMinute > 45000) return true; // nearly done
      return false; // truly forming — exclude
    });
    console.log(
      `[CandleBuilder] Seeded ${this._oneMinHistory.length} historical 1m candles`
    );
  }

  /**
   * Process a single tick from the Fyers data socket.
   * @param {{ ltp: number, timestamp: number }} tick
   *   timestamp is in SECONDS (Fyers WebSocket format)
   */
  processTick(tick) {
    const price = tick.ltp;
    if (!price || price <= 0) return;

    // Use server wall clock (Date.now()) for minute-boundary detection.
    // Fyers LiteMode tt (exchange timestamp) can lag by up to ~1s at minute
    // boundaries — using tt would cause the new candle to open late, making
    // the new candle's open = a later tick price instead of the first tick.
    const tsMs = Date.now();
    const minute = floorToMinute(tsMs);

    if (!this._forming1m) {
      // Very first tick
      this._forming1m = this._newCandle(minute, price);
    } else if (minute > this._forming1m.time) {
      // Minute rolled over → finalize current candle
      const closed = { ...this._forming1m };
      this._oneMinHistory.push(closed);

      // Emit finalized candle + new forming state
      this._forming1m = this._newCandle(minute, price);
      const forming = this._buildFormingAll();
      this.onFinalize(closed, forming);
    } else {
      // Same minute — update forming candle
      if (price > this._forming1m.high) this._forming1m.high = price;
      if (price < this._forming1m.low) this._forming1m.low = price;
      this._forming1m.close = price;
    }

    // Always emit tick update
    const forming = this._buildFormingAll();
    this.onTick(forming);
  }

  /**
   * Return the complete candle array for a given resolution,
   * combining completed history + current forming candle.
   *
   * @param {number} resolution - 1 | 3 | 5 | 15 | 60 | 1440
   * @returns {Array<{time, open, high, low, close, volume}>}
   */
  getCandlesForResolution(resolution) {
    const res = Number(resolution);
    const completed = this._buildCompletedBars(res);
    const forming = this._buildFormingBar(res);
    if (forming) return [...completed, forming];
    return completed;
  }

  /**
   * Get the raw completed 1m history (no forming candle).
   */
  getOneMinHistory() {
    return [...this._oneMinHistory];
  }

  // ── Private helpers ───────────────────────────────────────────

  _newCandle(timeMs, price) {
    return {
      time: timeMs,
      open: price,
      high: price,
      low: price,
      close: price,
      volume: 0,
    };
  }

  /**
   * Build all currently-forming candles for every supported resolution.
   * Returns { 1: candle, 3: candle, 5: candle, 15: candle, 60: candle, 1440: candle }
   */
  _buildFormingAll() {
    const result = {};
    for (const res of Object.keys(TF_MINUTES)) {
      result[Number(res)] = this._buildFormingBar(Number(res));
    }
    return result;
  }

  /**
   * Build the currently forming bar for a given resolution.
   * Aggregates all completed 1m candles in the CURRENT window +
   * the currently forming 1m candle.
   */
  _buildFormingBar(resolution) {
    if (!this._forming1m) return null;

    if (resolution === 1) {
      return { ...this._forming1m };
    }

    // Determine the window start for the current forming bar
    const windowStart = this._currentWindowStart(resolution, this._forming1m.time);

    // Collect completed 1m candles within this window
    const inWindow = this._oneMinHistory.filter(
      (c) => c.time >= windowStart
    );

    // Add the forming 1m candle
    const all = [...inWindow, this._forming1m];

    return this._aggregateCandles(all, windowStart);
  }

  /**
   * Build COMPLETED higher-TF bars from 1m history (no forming candle).
   */
  _buildCompletedBars(resolution) {
    if (resolution === 1) {
      return [...this._oneMinHistory];
    }

    if (this._oneMinHistory.length === 0) return [];

    if (resolution === 1440) {
      return this._buildDailyBars();
    }

    if (resolution === 10080) {
      return this._buildWeeklyBars();
    }

    const bars = [];
    let groupStart = null;
    let group = [];

    for (const candle of this._oneMinHistory) {
      const ws = this._windowStartForCandle(resolution, candle.time);

      if (groupStart === null) {
        groupStart = ws;
      }

      if (ws !== groupStart) {
        // New window — flush previous group as a completed bar
        if (group.length > 0) {
          bars.push(this._aggregateCandles(group, groupStart));
        }
        groupStart = ws;
        group = [];
      }
      group.push(candle);
    }

    // When the market is live the last group is still forming — skip it
    // (the forming bar is returned separately by _buildFormingBar).
    // When the market is closed every group is complete — include the last one too.
    if (group.length > 0 && !isMarketLiveNow()) {
      bars.push(this._aggregateCandles(group, groupStart));
    }
    return bars;
  }

  _buildDailyBars() {
    const byDay = new Map();
    for (const c of this._oneMinHistory) {
      const key = istDateKey(c.time);
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(c);
    }
    const bars = [];
    for (const [, dayCandles] of byDay) {
      if (dayCandles.length > 0) {
        const dayStart = floorToMinute(dayCandles[0].time);
        // Snap to market open 09:15 IST
        bars.push(this._aggregateCandles(dayCandles, dayStart));
      }
    }
    return bars;
  }

  /**
   * Build weekly bars by grouping 1m candles into ISO week buckets (Mon–Sun in IST).
   * Each week key is "YYYY-Www" using the IST date of the first candle in that week.
   */
  _buildWeeklyBars() {
    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
    const byWeek = new Map();

    for (const c of this._oneMinHistory) {
      const istDate = new Date(c.time + IST_OFFSET_MS);
      // ISO week: Monday = day 1. getUTCDay() returns 0=Sun … 6=Sat
      const dow = istDate.getUTCDay(); // 0=Sun,1=Mon,...,6=Sat
      // Days since Monday (Mon=0 … Sun=6)
      const daysSinceMon = (dow + 6) % 7;
      const monMs =
        Date.UTC(
          istDate.getUTCFullYear(),
          istDate.getUTCMonth(),
          istDate.getUTCDate() - daysSinceMon
        ) - IST_OFFSET_MS; // back to UTC epoch
      const weekKey = String(monMs); // unique per week start

      if (!byWeek.has(weekKey)) byWeek.set(weekKey, { monMs, candles: [] });
      byWeek.get(weekKey).candles.push(c);
    }

    const bars = [];
    const sortedKeys = [...byWeek.keys()].sort((a, b) => Number(a) - Number(b));
    for (const key of sortedKeys) {
      const { monMs, candles } = byWeek.get(key);
      if (candles.length > 0) {
        // Use Monday 09:15 IST as the bar timestamp
        const weekStart = monMs + (9 * 60 + 15) * 60 * 1000;
        bars.push(this._aggregateCandles(candles, weekStart));
      }
    }
    return bars;
  }

  /**
   * Compute the window-start timestamp for a given 1m candle time and resolution.
   * For intraday resolutions, windows are aligned to market open (09:15 IST).
   */
  _windowStartForCandle(resolution, tsMs) {
    if (resolution === 1440) return istDateKey(tsMs);

    if (resolution === 10080) {
      // Return Monday 09:15 IST of the week containing tsMs
      const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
      const istDate = new Date(tsMs + IST_OFFSET_MS);
      const dow = istDate.getUTCDay(); // 0=Sun … 6=Sat
      const daysSinceMon = (dow + 6) % 7;
      const monUtcMidnight = Date.UTC(
        istDate.getUTCFullYear(),
        istDate.getUTCMonth(),
        istDate.getUTCDate() - daysSinceMon
      );
      // Monday 09:15 IST = Monday 03:45 UTC
      return monUtcMidnight + (3 * 60 + 45) * 60 * 1000;
    }

    const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
    const istMs = tsMs + IST_OFFSET_MS;

    // Minutes since midnight IST
    const d = new Date(istMs);
    const minutesSinceMidnight = d.getUTCHours() * 60 + d.getUTCMinutes();

    // Use 09:00 anchor for MCX symbols, 09:15 for everything else
    const openHour = isMCXSymbol(this._symbol) ? MCX_OPEN_HOUR : MARKET_OPEN_HOUR;
    const openMin = isMCXSymbol(this._symbol) ? MCX_OPEN_MIN : MARKET_OPEN_MIN;
    const marketOpenMins = openHour * 60 + openMin;
    const minutesSinceOpen = minutesSinceMidnight - marketOpenMins;

    // Which window index are we in?
    const windowIndex = Math.floor(minutesSinceOpen / resolution);
    const windowMinuteSinceOpen = windowIndex * resolution;

    // Window start in IST
    const windowMinuteSinceMidnight = marketOpenMins + windowMinuteSinceOpen;
    const windowHour = Math.floor(windowMinuteSinceMidnight / 60);
    const windowMin = windowMinuteSinceMidnight % 60;

    // Build UTC ms for window start
    const dateStr = d.toISOString().slice(0, 10); // "YYYY-MM-DD"
    const windowUtc = new Date(`${dateStr}T${String(windowHour).padStart(2, '0')}:${String(windowMin).padStart(2, '0')}:00.000Z`).getTime()
      - IST_OFFSET_MS;

    return windowUtc;
  }

  _currentWindowStart(resolution, tsMs) {
    return this._windowStartForCandle(resolution, tsMs);
  }

  _aggregateCandles(candles, barTime) {
    if (!candles || candles.length === 0) return null;
    return {
      time: barTime,
      open: candles[0].open,
      high: Math.max(...candles.map((c) => c.high)),
      low: Math.min(...candles.map((c) => c.low)),
      close: candles[candles.length - 1].close,
      volume: candles.reduce((s, c) => s + (c.volume || 0), 0),
    };
  }
}

// ── Multi-TF helper (stateless, used by frontend via backend) ────

/**
 * Derive higher timeframe candles from an array of 1m candles.
 * Used when the frontend receives a batch of REST 1m candles and needs
 * to display 3m/5m/15m/1h/1D without extra API calls.
 *
 * @param {Array} oneMinCandles - sorted oldest first, OHLC
 * @param {number} resolution   - target resolution (3|5|15|60|1440)
 * @returns {Array} aggregated candles
 */
function deriveTimeframe(oneMinCandles, resolution) {
  if (!oneMinCandles || oneMinCandles.length === 0) return [];
  if (resolution === 1) return oneMinCandles;

  const builder = new CandleBuilder();
  builder.seedHistory(oneMinCandles);
  return builder._buildCompletedBars(resolution);
}

module.exports = { CandleBuilder, deriveTimeframe, floorToMinute, istDateKey };