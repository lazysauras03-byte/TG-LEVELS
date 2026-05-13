/**
 * WavesIndicator.js
 *
 * Wave lines   → lightweight-charts addLineSeries (move with chart automatically)
 * Labels       → <canvas> overlay redrawn on pan/zoom/resize
 *
 * Key design decisions for stability and smoothness:
 *
 *  1. SINGLE rAF on pan/zoom — not double-rAF.
 *     lightweight-charts fires subscribeVisibleLogicalRangeChange AFTER it has
 *     already updated its own canvas. A single rAF here fires in the very next
 *     frame, syncing the label canvas immediately. Double-rAF added ~32ms lag
 *     making labels visibly trail behind the wave lines during pan.
 *
 *  2. No-op if already queued — _scheduleRedraw() is a no-op when a rAF is
 *     already pending. Rapid pan events collapse into one paint per frame.
 *
 *  3. Crosshair suppressed during pan — _isPanning flag set on range-change,
 *     cleared 150ms after the last one. Crosshair redraws are skipped entirely
 *     while panning so they don't fight the pan redraws.
 *
 *  4. Pivot fingerprinting — line series rebuilt only when pivot structure
 *     changes (new swing). On tick updates where pivots are unchanged, only the
 *     canvas labels are refreshed — no chart series are added or removed.
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
            fromTime: candles[lastBar].time, toTime: candles[lb].time, midTime: candles[mbi].time,
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
            fromTime: candles[lastBar].time, toTime: candles[lb].time, midTime: candles[mbi].time,
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
let _series = null;   // candleSeries — for priceToCoordinate()
let _container = null;
let _canvas = null;
let _ctx = null;
let _onWaveData = null;
let _lines = [];
let _pivots = [];
let _segments = [];
let _rafId = null;   // pending rAF — only one allowed at a time
let _rangeUnsub = null;
let _crosshairUnsub = null;
let _resizeObs = null;
let _pivotFingerprint = "";

// Pan suppression
let _isPanning = false;
let _panClearId = null;
let _crosshairDebounceId = null;

// ─── Canvas helpers ───────────────────────────────────────────────────────────

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

// Return the pixel width of the right price scale so we can clip the canvas.
// Without clipping, wave labels near the right edge drift over the scale.
function _priceScaleWidth() {
  if (!_chart) return 0;
  try {
    const ps = _chart.priceScale('right');
    if (ps && typeof ps.width === 'function') return ps.width();
  } catch (_) { }
  return 0;
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

  // Clip to the plot area (exclude the right price scale).
  // This prevents pivot bubbles and segment labels from rendering
  // on top of or beyond the price scale when scrolled to the right.
  const scaleW = _priceScaleWidth();
  const plotW = Math.max(cw - scaleW, 0);

  const ts = _chart.timeScale();

  function toXY(timeMs, price) {
    try {
      const x = ts.timeToCoordinate(Math.floor(timeMs / 1000));
      const y = _series.priceToCoordinate(price);
      return (x == null || y == null) ? null : { x, y };
    } catch (_) { return null; }
  }

  // Clip drawing to the plot area — nothing renders beyond the scale boundary
  _ctx.save();
  _ctx.beginPath();
  _ctx.rect(0, 0, plotW, ch);
  _ctx.clip();

  // Pivot labels: HH / LH / HL / LL
  _pivots.forEach((piv) => {
    const pt = toXY(piv.time, piv.price);
    if (!pt) return;
    // Skip if the pivot's x position is beyond the visible plot area
    if (pt.x > plotW) return;
    const color = piv.side === "high" ? "#00d97e" : "#ff4560";
    _ctx.save();
    _ctx.font = "bold 11px 'JetBrains Mono',monospace";
    _ctx.textAlign = "center"; _ctx.textBaseline = "middle";
    const tw = _ctx.measureText(piv.waveType).width;
    const pad = 4, bw = tw + pad * 2, bh = 16;
    // Clamp label so it stays fully inside the plot area
    const rawBx = pt.x - bw / 2;
    const bx = Math.min(rawBx, plotW - bw - 2);
    const by = piv.side === "high" ? pt.y - bh - 6 : pt.y + 6;
    _ctx.fillStyle = "rgba(10,11,15,0.88)";
    _rrect(_ctx, bx, by, bw, bh, 3); _ctx.fill();
    _ctx.strokeStyle = color; _ctx.lineWidth = 1; _ctx.stroke();
    _ctx.fillStyle = color;
    _ctx.fillText(piv.waveType, bx + bw / 2, by + bh / 2);
    _ctx.restore();
  });

  // Diagonal segment labels — only draw if segment is wide enough to fit a label
  _segments.forEach((seg) => {
    const p1 = toXY(seg.fromTime, seg.fromPrice);
    const p2 = toXY(seg.toTime, seg.toPrice);
    if (!p1 || !p2) return;
    // Skip if the entire segment is beyond the plot area
    if (p1.x > plotW && p2.x > plotW) return;
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const segPixelLen = Math.sqrt(dx * dx + dy * dy);
    // Skip label if segment is too short — avoids overlap on zoomed-out charts
    if (segPixelLen < 40) return;
    const angle = Math.atan2(dy, dx);
    // Clamp midpoint x so label stays inside the plot area
    const rawMx = (p1.x + p2.x) / 2;
    const my = (p1.y + p2.y) / 2;
    const color = seg.toSide === "high" ? "#00d97e" : "#ff4560";
    const text = `Wave ${seg.waveNum}  ${seg.prevWaveType} \u2192 ${seg.currWaveType}`;
    _ctx.save();
    _ctx.font = "600 10px 'JetBrains Mono',monospace";
    _ctx.textAlign = "center"; _ctx.textBaseline = "middle";
    const tw = _ctx.measureText(text).width;
    const pad = 4, bw = tw + pad * 2, bh = 15, perpOff = -12;
    // Only draw label if segment is wide enough to actually show the text
    if (segPixelLen < bw) return;
    // Only clamp the label position, not the midpoint for rotation
    const mx = Math.min(rawMx, plotW - bw / 2 - 2);
    _ctx.translate(mx, my); _ctx.rotate(angle);
    _ctx.fillStyle = "rgba(10,11,15,0.82)";
    _rrect(_ctx, -bw / 2, perpOff - bh / 2, bw, bh, 3); _ctx.fill();
    _ctx.fillStyle = color;
    _ctx.fillText(text, 0, perpOff);
    _ctx.restore();
  });

  _ctx.restore(); // end clip
}

// ─── Scheduling ───────────────────────────────────────────────────────────────

// Single rAF — no-op if already queued. Rapid events collapse into one paint.
function _scheduleRedraw() {
  if (_rafId != null) return;
  _rafId = requestAnimationFrame(() => { _rafId = null; _redraw(); });
}

// Pan handler — sets _isPanning, suppresses crosshair redraws for 150ms.
function _onRangeChange() {
  _isPanning = true;
  if (_panClearId != null) clearTimeout(_panClearId);
  _panClearId = setTimeout(() => { _isPanning = false; _panClearId = null; }, 150);
  _scheduleRedraw();
}

// Crosshair handler — skipped during pan, debounced 60ms otherwise.
function _onCrosshairMove() {
  if (_isPanning) return;
  if (_crosshairDebounceId != null) return;
  _crosshairDebounceId = setTimeout(() => { _crosshairDebounceId = null; _scheduleRedraw(); }, 60);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function createWavesIndicator(chart, container, onWaveData, candleSeries) {
  _chart = chart; _series = candleSeries ?? null;
  _container = container; _onWaveData = onWaveData ?? null;
  _lines = []; _pivots = []; _segments = [];
  _rafId = null; _rangeUnsub = null; _crosshairUnsub = null;
  _pivotFingerprint = "";
  _isPanning = false; _panClearId = null; _crosshairDebounceId = null;
}

export function updateWavesIndicator(candles, emaHighs, emaLows) {
  if (!_chart || !candles?.length) return;

  const { pivots, segments } = updateWavesIndicatorPure(candles, emaHighs, emaLows);
  const fp = pivots.map((p) => `${p.barIndex}:${p.price}`).join("|");

  if (fp === _pivotFingerprint) {
    // Structure unchanged — just refresh canvas labels.
    _scheduleRedraw();
    return;
  }

  // New pivot structure — rebuild line series.
  _pivotFingerprint = fp;
  _clearOverlay();
  _pivots = pivots; _segments = segments;

  if (!pivots.length) { if (_onWaveData) _onWaveData([], []); return; }

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

  if (!_series && _lines.length) _series = _lines[0];
  _ensureCanvas();

  if (!_rangeUnsub && _chart) {
    _chart.timeScale().subscribeVisibleLogicalRangeChange(_onRangeChange);
    _rangeUnsub = () => {
      try { _chart.timeScale().unsubscribeVisibleLogicalRangeChange(_onRangeChange); } catch (_) { }
    };
  }
  if (!_crosshairUnsub && _chart) {
    _chart.subscribeCrosshairMove(_onCrosshairMove);
    _crosshairUnsub = () => {
      try { _chart.unsubscribeCrosshairMove(_onCrosshairMove); } catch (_) { }
    };
  }

  _scheduleRedraw();
  if (_onWaveData) _onWaveData(pivots, segments);
}

export function removeWavesIndicator(fullTeardown = false) {
  _clearOverlay();
  _pivots = []; _segments = []; _pivotFingerprint = "";
  if (_crosshairDebounceId != null) { clearTimeout(_crosshairDebounceId); _crosshairDebounceId = null; }
  if (_panClearId != null) { clearTimeout(_panClearId); _panClearId = null; }
  _isPanning = false;

  if (fullTeardown) {
    if (_rangeUnsub) { _rangeUnsub(); _rangeUnsub = null; }
    if (_crosshairUnsub) { _crosshairUnsub(); _crosshairUnsub = null; }
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