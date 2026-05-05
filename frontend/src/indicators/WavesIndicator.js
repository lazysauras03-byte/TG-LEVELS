/**
 * WavesIndicator.js
 *
 * Rendering:
 *   - Wave lines: lightweight-charts addLineSeries (correct coordinate space)
 *   - Labels: <canvas> overlay drawn after chart paint via double-rAF
 *       * Pivot labels  (HH/LH/HL/LL) at each pivot — above highs, below lows
 *       * Segment labels (Wave -N  PREV → CURR) rotated diagonally along each wave
 *
 * Price→pixel:  uses the passed-in candleSeries.priceToCoordinate()
 *               (lightweight-charts v4: priceToCoordinate lives on ISeriesApi,
 *                NOT on IPriceScaleApi returned by chart.priceScale())
 */

const MAX_WAVES = 50;

// ─── Pure wave calculation ────────────────────────────────────────────────────

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

export function updateWavesIndicatorPure(candles, emaHighs, emaLows) {
  if (!candles?.length) return { pivots: [], segments: [] };

  const eH = emaHighs?.length === candles.length
    ? emaHighs : calcEMA(candles.map((c) => c.high), 9);
  const eL = emaLows?.length === candles.length
    ? emaLows : calcEMA(candles.map((c) => c.low), 9);

  let state = 0, bestPrice = null, bestBar = null, legTouchedEMA = false;
  let lastPrice = null, lastBar = null, prevWaveType = "";
  let prevHigh = null, prevLow = null, currWaveType = "";

  const pivots = [], segments = [];

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
      if (bestPrice === null || c.high > bestPrice) { bestPrice = c.high; bestBar = i; }
      if (touchHigh) legTouchedEMA = true;
      if (touchLow && legTouchedEMA) {
        const lp = bestPrice, lb = bestBar;
        currWaveType = prevHigh === null ? "HH" : lp > prevHigh ? "HH" : "LH";
        prevHigh = lp;
        pivots.push({ barIndex: lb, price: lp, side: "high", waveType: currWaveType, time: candles[lb].time });
        if (lastPrice !== null) {
          const mbi = Math.floor((lastBar + lb) / 2);
          segments.push({
            fromBarIndex: lastBar, fromPrice: lastPrice,
            toBarIndex: lb, toPrice: lp,
            midBarIndex: mbi, midPrice: (lastPrice + lp) / 2,
            prevWaveType, currWaveType, toSide: "high",
            fromTime: candles[lastBar].time,
            toTime: candles[lb].time,
            midTime: candles[mbi].time,
          });
        }
        prevWaveType = currWaveType; lastPrice = lp; lastBar = lb;
        state = -1; bestPrice = c.low; bestBar = i; legTouchedEMA = touchLow;
      }
      continue;
    }

    if (state === -1) {
      if (bestPrice === null || c.low < bestPrice) { bestPrice = c.low; bestBar = i; }
      if (touchLow) legTouchedEMA = true;
      if (touchHigh && legTouchedEMA) {
        const lp = bestPrice, lb = bestBar;
        currWaveType = prevLow === null ? "LL" : lp < prevLow ? "LL" : "HL";
        prevLow = lp;
        pivots.push({ barIndex: lb, price: lp, side: "low", waveType: currWaveType, time: candles[lb].time });
        if (lastPrice !== null) {
          const mbi = Math.floor((lastBar + lb) / 2);
          segments.push({
            fromBarIndex: lastBar, fromPrice: lastPrice,
            toBarIndex: lb, toPrice: lp,
            midBarIndex: mbi, midPrice: (lastPrice + lp) / 2,
            prevWaveType, currWaveType, toSide: "low",
            fromTime: candles[lastBar].time,
            toTime: candles[lb].time,
            midTime: candles[mbi].time,
          });
        }
        prevWaveType = currWaveType; lastPrice = lp; lastBar = lb;
        state = 1; bestPrice = c.high; bestBar = i; legTouchedEMA = touchHigh;
      }
      continue;
    }
  }

  const tp = pivots.slice(-MAX_WAVES), np = tp.length;
  const ts = segments.slice(-MAX_WAVES), ns = ts.length;
  return {
    pivots: tp.map((p, i) => ({ ...p, waveNum: -(np - i) })),
    segments: ts.map((s, i) => ({ ...s, waveNum: -(ns - i) })),
  };
}

// ─── Overlay state ────────────────────────────────────────────────────────────

let _chart = null;
let _series = null;   // candleSeries — used for priceToCoordinate()
let _container = null;
let _canvas = null;
let _ctx = null;
let _onWaveData = null;
let _lines = [];
let _pivots = [];
let _segments = [];
let _rafId = null;
let _loopId = null;   // ← continuous rAF loop handle (NEW)
let _rangeUnsub = null;
let _resizeObs = null;

// ─── Canvas helpers ───────────────────────────────────────────────────────────

// roundRect polyfill for Chrome < 99
function _rrect(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === "function") {
    ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
}

function _ensureCanvas() {
  if (_canvas && _container.contains(_canvas)) return;

  const old = _container.querySelector(".__wc");
  if (old) try { _container.removeChild(old); } catch (_) { }

  _canvas = document.createElement("canvas");
  _canvas.className = "__wc";
  _canvas.style.cssText = "position:absolute;top:0;left:0;pointer-events:none;z-index:5;";
  _container.appendChild(_canvas);
  _ctx = _canvas.getContext("2d");
  _syncSize();

  _resizeObs = new ResizeObserver(() => { _syncSize(); _scheduleRedraw(); });
  _resizeObs.observe(_container);
}

function _syncSize() {
  if (!_canvas || !_container) return;
  const dpr = window.devicePixelRatio || 1;
  const w = _container.clientWidth, h = _container.clientHeight;
  _canvas.width = w * dpr; _canvas.height = h * dpr;
  _canvas.style.width = `${w}px`; _canvas.style.height = `${h}px`;
  if (_ctx) _ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function _removeCanvas() {
  if (_resizeObs) { _resizeObs.disconnect(); _resizeObs = null; }
  if (_canvas) { try { _canvas.parentNode?.removeChild(_canvas); } catch (_) { } _canvas = null; _ctx = null; }
}

// ─── Drawing ──────────────────────────────────────────────────────────────────

function _redraw() {
  if (!_ctx || !_canvas || !_chart || !_series) return;

  const cw = _canvas.clientWidth, ch = _canvas.clientHeight;
  _ctx.clearRect(0, 0, cw, ch);
  if (!_pivots.length) return;

  const ts = _chart.timeScale();

  // ── price → pixel via the candleSeries (correct in lw-charts v4) ─────
  function toXY(timeMs, price) {
    try {
      const x = ts.timeToCoordinate(Math.floor(timeMs / 1000));
      const y = _series.priceToCoordinate(price);
      return (x == null || y == null) ? null : { x, y };
    } catch (_) { return null; }
  }

  // ── 1. Pivot labels: HH / LH / HL / LL ──────────────────────────────
  _pivots.forEach((piv) => {
    const pt = toXY(piv.time, piv.price);
    if (!pt) return;

    const color = piv.side === "high" ? "#00d97e" : "#ff4560";
    _ctx.save();
    _ctx.font = "bold 11px 'JetBrains Mono',monospace";
    _ctx.textAlign = "center";
    _ctx.textBaseline = "middle";

    const tw = _ctx.measureText(piv.waveType).width;
    const pad = 4, bw = tw + pad * 2, bh = 16;
    const bx = pt.x - bw / 2;
    const by = piv.side === "high" ? pt.y - bh - 6 : pt.y + 6;

    _ctx.fillStyle = "rgba(10,11,15,0.88)";
    _rrect(_ctx, bx, by, bw, bh, 3);
    _ctx.fill();
    _ctx.strokeStyle = color; _ctx.lineWidth = 1; _ctx.stroke();
    _ctx.fillStyle = color;
    _ctx.fillText(piv.waveType, pt.x, by + bh / 2);
    _ctx.restore();
  });

  // ── 2. Diagonal segment labels ────────────────────────────────────────
  _segments.forEach((seg) => {
    const p1 = toXY(seg.fromTime, seg.fromPrice);
    const p2 = toXY(seg.toTime, seg.toPrice);
    if (!p1 || !p2) return;

    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const angle = Math.atan2(dy, dx);
    const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;

    const color = seg.toSide === "high" ? "#00d97e" : "#ff4560";
    const text = `Wave ${seg.waveNum}  ${seg.prevWaveType} \u2192 ${seg.currWaveType}`;

    _ctx.save();
    _ctx.translate(mx, my);
    _ctx.rotate(angle);
    _ctx.font = "600 10px 'JetBrains Mono',monospace";
    _ctx.textAlign = "center";
    _ctx.textBaseline = "middle";

    const tw = _ctx.measureText(text).width;
    const pad = 4, bw = tw + pad * 2, bh = 15;
    const perpOff = -12;   // shift above the wave line

    _ctx.fillStyle = "rgba(10,11,15,0.82)";
    _rrect(_ctx, -bw / 2, perpOff - bh / 2, bw, bh, 3);
    _ctx.fill();
    _ctx.fillStyle = color;
    _ctx.fillText(text, 0, perpOff);
    _ctx.restore();
  });
}

function _scheduleRedraw() {
  if (_rafId != null) cancelAnimationFrame(_rafId);
  _rafId = requestAnimationFrame(() => {
    _rafId = requestAnimationFrame(() => { _redraw(); _rafId = null; });
  });
}

// ── Continuous rAF loop — redraws every frame while waves are active ──────────
// This keeps labels pixel-perfect during pan/zoom/scroll without waiting for
// the subscribeVisibleLogicalRangeChange debounce to fire. (NEW)
function _startLoop() {
  if (_loopId != null) return;
  function loop() {
    _redraw();
    _loopId = requestAnimationFrame(loop);
  }
  _loopId = requestAnimationFrame(loop);
}

function _stopLoop() {
  if (_loopId != null) { cancelAnimationFrame(_loopId); _loopId = null; }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * @param chart       - IChartApi
 * @param container   - DOM element wrapping the chart
 * @param onWaveData  - callback(pivots, segments)
 * @param candleSeries - ISeriesApi — needed for priceToCoordinate() in lw-charts v4
 */
export function createWavesIndicator(chart, container, onWaveData, candleSeries) {
  _chart = chart;
  _series = candleSeries ?? null;
  _container = container;
  _onWaveData = onWaveData ?? null;
  _lines = []; _pivots = []; _segments = [];
  _rafId = null; _rangeUnsub = null;
}

export function updateWavesIndicator(candles, emaHighs, emaLows) {
  if (!_chart || !candles?.length) return;

  _clearOverlay();

  const { pivots, segments } = updateWavesIndicatorPure(candles, emaHighs, emaLows);
  _pivots = pivots; _segments = segments;

  if (!pivots.length) { if (_onWaveData) _onWaveData([], []); return; }

  // Wave lines
  for (let i = 1; i < pivots.length; i++) {
    const from = pivots[i - 1], to = pivots[i];
    try {
      const ls = _chart.addLineSeries({
        color: to.side === "high" ? "rgba(0,217,126,0.85)" : "rgba(255,69,96,0.85)",
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      ls.setData([
        { time: Math.floor(from.time / 1000), value: from.price },
        { time: Math.floor(to.time / 1000), value: to.price },
      ]);
      _lines.push(ls);
    } catch (_) { }
  }

  // If no candleSeries was passed, try to borrow the first wave line series for coords
  if (!_series && _lines.length) _series = _lines[0];

  _ensureCanvas();

  if (!_rangeUnsub && _chart) {
    const h = () => _scheduleRedraw();
    _chart.timeScale().subscribeVisibleLogicalRangeChange(h);
    _rangeUnsub = () => { try { _chart.timeScale().unsubscribeVisibleLogicalRangeChange(h); } catch (_) { } };
  }

  _scheduleRedraw();
  _startLoop(); // ← start continuous loop so labels stay stable every frame (NEW)
  if (_onWaveData) _onWaveData(pivots, segments);
}

export function removeWavesIndicator(fullTeardown = false) {
  _clearOverlay();
  _pivots = []; _segments = [];
  _stopLoop(); // ← stop loop when waves removed (NEW)

  if (fullTeardown) {
    if (_rangeUnsub) { _rangeUnsub(); _rangeUnsub = null; }
    _removeCanvas();
    _chart = null; _series = null; _container = null; _onWaveData = null;
  } else {
    if (_ctx && _canvas) _ctx.clearRect(0, 0, _canvas.clientWidth, _canvas.clientHeight);
  }

  if (_onWaveData) _onWaveData([], []);
}

function _clearOverlay() {
  if (_rafId != null) { cancelAnimationFrame(_rafId); _rafId = null; }
  if (_chart) _lines.forEach((s) => { try { _chart.removeSeries(s); } catch (_) { } });
  _lines = [];
  if (_ctx && _canvas) _ctx.clearRect(0, 0, _canvas.clientWidth, _canvas.clientHeight);
}