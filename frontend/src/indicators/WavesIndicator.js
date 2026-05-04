/**
 * WavesIndicator.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Mirrors updated Pine Script "EMA 9 Structure Waves (Negative Numbering)".
 *
 * Changes vs previous version:
 *   - legTouchedEMA guard (matches Bubble logic)
 *   - HH / LH / HL / LL wave type tracking
 *   - Wave labels: "Wave -N prevType → currType"
 *   - onWaveData(pivots, lines) callback → React sidebar can consume
 *
 * Public API:
 *   createWavesIndicator(chart, container, onWaveData?)
 *   updateWavesIndicator(candles, emaHighs, emaLows)
 *   removeWavesIndicator()
 * ─────────────────────────────────────────────────────────────────────────────
 */

const MAX_WAVES = 50;

// ─── Module-level refs ───────────────────────────────────────────────────────
let _chart = null;
let _container = null;
let _refSeries = null;
let _onWaveData = null;   // (pivots, segments) => void

let _waveSeriesList = [];
let _labelEls = [];

// ─── EMA helper ───────────────────────────────────────────────────────────────
function calcEMA(prices, period) {
  const k = 2 / (period + 1);
  const result = new Array(prices.length).fill(null);
  let ema = null;
  for (let i = 0; i < prices.length; i++) {
    const p = prices[i];
    if (p == null || isNaN(p)) continue;
    ema = ema === null ? p : p * k + ema * (1 - k);
    result[i] = ema;
  }
  return result;
}

// ─── Label DOM helpers ────────────────────────────────────────────────────────
function createLabelEl(text, side) {
  const el = document.createElement("div");
  el.setAttribute("data-waves-label", "1");
  el.innerText = text;
  Object.assign(el.style, {
    position: "absolute",
    pointerEvents: "none",
    userSelect: "none",
    background: "#111827",
    color: "#f5a623",
    fontSize: "10px",
    fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
    fontWeight: "600",
    padding: "2px 5px",
    borderRadius: "3px",
    border: "1px solid rgba(245,166,35,0.4)",
    whiteSpace: "nowrap",
    zIndex: "20",
    transform: "translateX(-50%)",
  });
  return el;
}

function repositionLabels() {
  if (!_chart || !_container || !_refSeries) return;
  const ts = _chart.timeScale();
  _labelEls.forEach(({ el, barIndex, price, side, candles }) => {
    if (!candles || barIndex >= candles.length) { el.style.display = "none"; return; }
    const unixSec = Math.floor(candles[barIndex].time / 1000);
    const x = ts.timeToCoordinate(unixSec);
    const y = _refSeries.priceToCoordinate(price);
    if (x == null || y == null) { el.style.display = "none"; return; }
    el.style.display = "block";
    el.style.left = `${x}px`;
    el.style.top = side === "down" ? `${y - 22}px` : `${y + 6}px`;
  });
}

// ─── Internal cleanup ─────────────────────────────────────────────────────────
function _clearDrawings() {
  _waveSeriesList.forEach((s) => {
    try { if (_chart) _chart.removeSeries(s); } catch (_) { }
  });
  _waveSeriesList = [];
  try { if (_refSeries) _refSeries.setData([]); } catch (_) { }
  _labelEls.forEach(({ el }) => {
    try { if (el.parentNode) el.parentNode.removeChild(el); } catch (_) { }
  });
  _labelEls = [];
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function createWavesIndicator(chart, container, onWaveData = null) {
  _chart = chart;
  _container = container;
  _onWaveData = onWaveData;

  _refSeries = chart.addLineSeries({
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
    color: "transparent",
    lineWidth: 1,
  });

  chart.timeScale().subscribeVisibleTimeRangeChange(repositionLabels);
  chart.subscribeCrosshairMove(repositionLabels);
}

export function updateWavesIndicator(candles, emaHighs, emaLows) {
  if (!_chart || !_container || !candles?.length) return;
  _clearDrawings();

  const eH = (emaHighs?.length === candles.length) ? emaHighs : calcEMA(candles.map((c) => c.high), 9);
  const eL = (emaLows?.length === candles.length) ? emaLows : calcEMA(candles.map((c) => c.low), 9);

  // ── Pine Script bar-by-bar replay (matches updated Pine) ─────────────────
  let state = 0;
  let bestPrice = null;
  let bestBar = null;
  let legTouchedEMA = false;

  let lastPrice = null;
  let lastBar = null;

  let prevHigh = null;
  let prevLow = null;
  let prevWaveType = "";
  let currWaveType = "";

  // Pivots: { barIndex, price, side, waveNum (set later), label }
  const pivots = [];
  // Segments: { fromBar, fromPrice, toBar, toPrice, waveNum, waveLabel }
  const segments = [];

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const emaH = eH[i];
    const emaL = eL[i];
    if (emaH == null || emaL == null) continue;

    // Pine Script touch logic (same as Bubble):
    // hhTouch = (isGreen && close > ema9High) || (isRed && open > ema9High)
    // llTouch = (isGreen && open < ema9Low) || (isRed && close < ema9Low)
    const isGreen = c.close > c.open;
    const isRed = c.close < c.open;
    const touchHigh = (isGreen && c.close > emaH) || (isRed && c.open > emaH);
    const touchLow = (isGreen && c.open < emaL) || (isRed && c.close < emaL);

    // ── INIT ──────────────────────────────────────────────────────────────
    if (state === 0) {
      if (touchHigh) { state = 1; bestPrice = c.high; bestBar = i; legTouchedEMA = true; }
      else if (touchLow) { state = -1; bestPrice = c.low; bestBar = i; legTouchedEMA = true; }
      continue;
    }

    // ── HIGH TRACKING ─────────────────────────────────────────────────────
    if (state === 1) {
      if (bestPrice === null || c.high > bestPrice) { bestPrice = c.high; bestBar = i; }
      if (touchHigh) legTouchedEMA = true;

      if (touchLow && legTouchedEMA) {
        const lockPrice = bestPrice;
        const lockBar = bestBar;

        currWaveType = prevHigh === null ? "HH" : (lockPrice > prevHigh ? "HH" : "LH");
        prevHigh = lockPrice;

        const waveLabel = `Wave X ${prevWaveType} → ${currWaveType}`;

        if (lastPrice !== null) {
          segments.push({
            fromBar: lastBar, fromPrice: lastPrice,
            toBar: lockBar, toPrice: lockPrice,
            prevWaveType, currWaveType,
          });
        }

        pivots.push({ barIndex: lockBar, price: lockPrice, side: "high", waveType: currWaveType });

        prevWaveType = currWaveType;
        lastPrice = lockPrice;
        lastBar = lockBar;

        state = -1;
        bestPrice = c.low;
        bestBar = i;
        legTouchedEMA = touchLow;
      }
      continue;
    }

    // ── LOW TRACKING ──────────────────────────────────────────────────────
    if (state === -1) {
      if (bestPrice === null || c.low < bestPrice) { bestPrice = c.low; bestBar = i; }
      if (touchLow) legTouchedEMA = true;

      if (touchHigh && legTouchedEMA) {
        const lockPrice = bestPrice;
        const lockBar = bestBar;

        currWaveType = prevLow === null ? "LL" : (lockPrice < prevLow ? "LL" : "HL");
        prevLow = lockPrice;

        if (lastPrice !== null) {
          segments.push({
            fromBar: lastBar, fromPrice: lastPrice,
            toBar: lockBar, toPrice: lockPrice,
            prevWaveType, currWaveType,
          });
        }

        pivots.push({ barIndex: lockBar, price: lockPrice, side: "low", waveType: currWaveType });

        prevWaveType = currWaveType;
        lastPrice = lockPrice;
        lastBar = lockBar;

        state = 1;
        bestPrice = c.high;
        bestBar = i;
        legTouchedEMA = touchHigh;
      }
      continue;
    }
  }

  // Trim to MAX_WAVES (keep latest)
  const trimmedSegments = segments.slice(-MAX_WAVES);
  const trimmedPivots = pivots.slice(-MAX_WAVES);

  // Apply negative wave numbering (latest = -1)
  const total = trimmedPivots.length;
  const enrichedPivots = trimmedPivots.map((piv, i) => ({
    ...piv,
    waveNum: -(total - i),          // -1 = latest, -N = oldest
    time: candles[piv.barIndex].time,
  }));

  const enrichedSegments = trimmedSegments.map((seg, i) => ({
    ...seg,
    waveNum: -(trimmedSegments.length - i),
    fromTime: candles[seg.fromBar].time,
    toTime: candles[seg.toBar].time,
  }));

  // ── Draw line segments ────────────────────────────────────────────────────
  trimmedSegments.forEach((seg) => {
    const fromTime = Math.floor(candles[seg.fromBar].time / 1000);
    const toTime = Math.floor(candles[seg.toBar].time / 1000);
    if (fromTime >= toTime) return;

    const series = _chart.addLineSeries({
      color: "rgba(245,166,35,0.85)",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    series.setData([
      { time: fromTime, value: seg.fromPrice },
      { time: toTime, value: seg.toPrice },
    ]);
    _waveSeriesList.push(series);
  });

  // Feed refSeries pivot prices for priceToCoordinate()
  if (_refSeries && trimmedPivots.length > 0) {
    const refData = trimmedPivots
      .map((piv) => ({ time: Math.floor(candles[piv.barIndex].time / 1000), value: piv.price }))
      .sort((a, b) => a.time - b.time);
    const seen = new Set();
    const unique = refData.filter(({ time }) => seen.has(time) ? false : seen.add(time));
    try { _refSeries.setData(unique); } catch (_) { }
  }

  // ── Draw DOM labels with negative wave numbering ──────────────────────────
  enrichedPivots.forEach((piv) => {
    const side = piv.side === "high" ? "down" : "up";
    const el = createLabelEl(`Wave ${piv.waveNum} · ${piv.waveType}`, side);
    _container.appendChild(el);
    _labelEls.push({ el, barIndex: piv.barIndex, price: piv.price, side, candles });
  });

  repositionLabels();

  // ── Fire callback so React sidebar can render wave data ───────────────────
  if (_onWaveData) {
    _onWaveData(enrichedPivots, enrichedSegments);
  }
}

export function removeWavesIndicator() {
  _clearDrawings();
  if (_onWaveData) _onWaveData([], []);
}