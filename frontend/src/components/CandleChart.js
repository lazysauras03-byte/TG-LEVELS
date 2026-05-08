// CandleChart.js — production-grade fix:
//   • viewport/zoom/scroll NEVER reset on background socket updates
//   • incremental candle update (update() not setData()) when only last candle changed
//   • intentionalReload flag drives resetView() — NOT auto-refresh
//   • WavesIndicator continuous rAF loop removed → only redraws on actual change
import React, { useEffect, useRef, useCallback } from "react";
import { createChart, CrosshairMode, LineStyle } from "lightweight-charts";
import {
  createWavesIndicator,
  updateWavesIndicator,
  removeWavesIndicator,
} from "../indicators/WavesIndicator";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toISTDate(tsMs) {
  return new Date(tsMs).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
}

function buildMarkers(signals, candles, todayModeOn) {
  let src = signals || [];
  if (todayModeOn && candles.length > 0) {
    const latestIST = toISTDate(candles.at(-1).time);
    src = src.filter((s) => toISTDate(s.time) === latestIST);
  }
  const seen = new Set();
  const markers = [];
  src.forEach((sig) => {
    const t = Math.floor(sig.time / 1000);
    const key = `${sig.type}-${t}`;
    if (seen.has(key)) return;
    seen.add(key);
    switch (sig.type) {
      case "NH":
        markers.push({ time: t, position: "aboveBar", color: "#00d97e", shape: "arrowDown", text: "NH", size: 1 });
        break;
      case "NL":
        markers.push({ time: t, position: "belowBar", color: "#ff4560", shape: "arrowUp", text: "NL", size: 1 });
        break;
      case "BC_HIGH":
        markers.push({ time: t, position: "aboveBar", color: "#ffc135", shape: "arrowDown", text: "BC", size: 1 });
        break;
      case "BC_LOW":
        markers.push({ time: t, position: "belowBar", color: "#ffc135", shape: "arrowUp", text: "BC", size: 1 });
        break;
      default: break;
    }
  });
  markers.sort((a, b) => a.time - b.time);
  return markers;
}

// Deduplicated setMarkers — only calls the expensive lw-charts API when the
// marker set actually changed. Compares a cheap key string. The keyRef is
// passed in so multiple callers share the same dedup state.
function setMarkersIfChanged(series, markers, keyRef) {
  const key = markers.map((m) => `${m.time}:${m.text}`).join("|");
  if (key === keyRef.current) return;
  keyRef.current = key;
  series.setMarkers(markers);
}

// ─── Ruler overlay ────────────────────────────────────────────────────────────
class RulerOverlay {
  constructor(container, chartRef, candleSeriesRef) {
    this.container = container;
    this.chartRef = chartRef;
    this.candleSeriesRef = candleSeriesRef;

    this.canvas = document.createElement("canvas");
    this.canvas.style.cssText = [
      "position:absolute", "inset:0", "pointer-events:none",
      "z-index:20", "border-radius:inherit",
    ].join(";");
    container.style.position = "relative";
    container.appendChild(this.canvas);

    this.ctx = this.canvas.getContext("2d");
    this.active = false;
    this.startPt = null;
    this.endPt = null;
    this._lastMouse = null;

    this._rafId = null;
    this._bound = {
      keydown: this._onKeyDown.bind(this),
      keyup: this._onKeyUp.bind(this),
      mousemove: this._onMouseMove.bind(this),
      resize: this._onResize.bind(this),
    };

    window.addEventListener("keydown", this._bound.keydown);
    window.addEventListener("keyup", this._bound.keyup);
    window.addEventListener("mousemove", this._bound.mousemove);
    window.addEventListener("resize", this._bound.resize);

    this._onResize();
  }

  _onResize() {
    const r = this.container.getBoundingClientRect();
    this.canvas.width = r.width;
    this.canvas.height = r.height;
    this._draw();
  }

  _onKeyDown(e) {
    if (e.key !== "Control" || this.active) return;
    this.active = true;
    this.container.style.cursor = "crosshair";
    this.startPt = this._lastMouse ? { ...this._lastMouse } : null;
    this.endPt = this.startPt ? { ...this.startPt } : null;
    this._scheduleDraw();
  }

  _onKeyUp(e) {
    if (e.key !== "Control") return;
    this.active = false;
    this.startPt = null;
    this.endPt = null;
    this.container.style.cursor = "";
    this._clear();
  }

  _rel(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  _onMouseMove(e) {
    const pt = this._rel(e);
    this._lastMouse = pt;
    if (!this.active) return;
    if (!this.startPt) { this.startPt = { ...pt }; }
    this.endPt = pt;
    this._scheduleDraw();
  }

  _scheduleDraw() {
    if (this._rafId) return;
    this._rafId = requestAnimationFrame(() => {
      this._rafId = null;
      this._draw();
    });
  }

  _clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  _xToTime(x) {
    try { return this.chartRef.current?.timeScale().coordinateToTime(x); } catch { return null; }
  }

  _yToPrice(y) {
    try { return this.candleSeriesRef.current?.coordinateToPrice(y); } catch { return null; }
  }

  _candleAt(unixSec, candles) {
    if (!candles?.length || unixSec == null) return null;
    let best = null, bestDiff = Infinity;
    for (const c of candles) {
      const t = Math.floor(c.time / 1000);
      const d = Math.abs(t - unixSec);
      if (d < bestDiff) { bestDiff = d; best = c; }
    }
    return best;
  }

  _draw() {
    this._clear();
    if (!this.startPt || !this.endPt) return;

    const ctx = this.ctx;
    const { startPt, endPt } = this;
    const W = this.canvas.width;
    const H = this.canvas.height;

    const t1 = this._xToTime(startPt.x);
    const t2 = this._xToTime(endPt.x);
    const p1 = this._yToPrice(startPt.y);
    const p2 = this._yToPrice(endPt.y);

    if (p1 == null || p2 == null) return;

    const x1 = startPt.x, y1 = startPt.y;
    const x2 = endPt.x, y2 = endPt.y;

    const isBull = p2 >= p1;
    const clrLine = isBull ? "rgba(0,217,126,0.85)" : "rgba(255,69,96,0.85)";
    const clrFill = isBull ? "rgba(0,217,126,0.08)" : "rgba(255,69,96,0.08)";
    const clrTxt = "#e4e8f5";
    const clrMute = "#7a8099";
    const clrBg = "rgba(14,16,26,0.92)";
    const clrBdr = isBull ? "rgba(0,217,126,0.55)" : "rgba(255,69,96,0.55)";

    ctx.fillStyle = clrFill;
    ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));

    const midY = (y1 + y2) / 2;
    ctx.save();
    ctx.strokeStyle = clrLine;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(Math.min(x1, x2), midY);
    ctx.lineTo(Math.max(x1, x2), midY);
    ctx.stroke();
    ctx.setLineDash([]);

    [x1, x2].forEach((x) => {
      ctx.strokeStyle = clrLine;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x, Math.min(y1, y2));
      ctx.lineTo(x, Math.max(y1, y2));
      ctx.stroke();
    });

    [y1, y2].forEach((y) => {
      ctx.strokeStyle = clrLine;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(Math.min(x1, x2), y);
      ctx.lineTo(Math.max(x1, x2), y);
      ctx.stroke();
    });

    [[x1, y1], [x2, y1], [x1, y2], [x2, y2]].forEach(([cx, cy]) => {
      ctx.fillStyle = clrLine;
      ctx.beginPath();
      ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = clrLine;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();

    const dPrice = p2 - p1;
    const dPct = p1 !== 0 ? (dPrice / Math.abs(p1)) * 100 : 0;
    const sign = dPrice >= 0 ? "+" : "";

    let barCount = 0;
    if (t1 != null && t2 != null) {
      const allCandles = window.__tggCandles || [];
      const idx1 = allCandles.findIndex((c) => Math.floor(c.time / 1000) >= Math.min(t1, t2));
      const idx2 = allCandles.findIndex((c) => Math.floor(c.time / 1000) >= Math.max(t1, t2));
      barCount = Math.abs((idx2 < 0 ? allCandles.length : idx2) - (idx1 < 0 ? 0 : idx1));
    }

    function fmtIST(unixSec) {
      if (!unixSec) return "—";
      const d = new Date((unixSec + 19800) * 1000);
      const dd = String(d.getUTCDate()).padStart(2, "0");
      const mon = d.toLocaleString("en", { month: "short", timeZone: "UTC" });
      const hh = String(d.getUTCHours()).padStart(2, "0");
      const mm = String(d.getUTCMinutes()).padStart(2, "0");
      return `${dd} ${mon} ${hh}:${mm}`;
    }

    const numFmt = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const lines = [
      { label: "Δ Price", value: `${sign}${numFmt.format(dPrice)}`, color: clrLine },
      { label: "Δ %", value: `${sign}${Math.abs(dPct).toFixed(2)}%`, color: clrLine },
      { label: "Bars", value: String(barCount), color: clrMute },
      { label: "From", value: fmtIST(Math.min(t1 ?? 0, t2 ?? 0)), color: clrMute },
      { label: "To", value: fmtIST(Math.max(t1 ?? 0, t2 ?? 0)), color: clrMute },
    ];

    const padding = 10;
    const lineH = 18;
    const boxW = 178;
    const boxH = lines.length * lineH + padding * 2;

    let tipX = Math.max(x1, x2) + 12;
    let tipY = (y1 + y2) / 2 - boxH / 2;
    if (tipX + boxW > W - 8) tipX = Math.min(x1, x2) - boxW - 12;
    if (tipX < 8) tipX = 8;
    if (tipY < 8) tipY = 8;
    if (tipY + boxH > H - 8) tipY = H - boxH - 8;

    ctx.save();
    const r = 7;
    ctx.beginPath();
    ctx.moveTo(tipX + r, tipY);
    ctx.lineTo(tipX + boxW - r, tipY);
    ctx.quadraticCurveTo(tipX + boxW, tipY, tipX + boxW, tipY + r);
    ctx.lineTo(tipX + boxW, tipY + boxH - r);
    ctx.quadraticCurveTo(tipX + boxW, tipY + boxH, tipX + boxW - r, tipY + boxH);
    ctx.lineTo(tipX + r, tipY + boxH);
    ctx.quadraticCurveTo(tipX, tipY + boxH, tipX, tipY + boxH - r);
    ctx.lineTo(tipX, tipY + r);
    ctx.quadraticCurveTo(tipX, tipY, tipX + r, tipY);
    ctx.closePath();
    ctx.fillStyle = clrBg;
    ctx.fill();
    ctx.strokeStyle = clrBdr;
    ctx.lineWidth = 1.2;
    ctx.stroke();

    lines.forEach((ln, i) => {
      const ly = tipY + padding + i * lineH + lineH / 2;
      ctx.font = "600 11px 'JetBrains Mono', monospace";
      ctx.fillStyle = clrMute;
      ctx.textBaseline = "middle";
      ctx.fillText(ln.label, tipX + padding, ly);

      ctx.font = "700 11px 'JetBrains Mono', monospace";
      ctx.fillStyle = ln.color;
      ctx.textAlign = "right";
      ctx.fillText(ln.value, tipX + boxW - padding, ly);
      ctx.textAlign = "left";
    });
    ctx.restore();

    [[p1, y1], [p2, y2]].forEach(([price, py]) => {
      const label = numFmt.format(price);
      const lw = ctx.measureText(label).width + 16;
      const lh = 18;
      const lx = W - lw - 2;
      const ly = py - lh / 2;
      ctx.save();
      ctx.fillStyle = isBull ? "rgba(0,217,126,0.9)" : "rgba(255,69,96,0.9)";
      ctx.beginPath();
      ctx.roundRect(lx, ly, lw, lh, 3);
      ctx.fill();
      ctx.font = "700 10px 'JetBrains Mono', monospace";
      ctx.fillStyle = "#0a0b0f";
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      ctx.fillText(label, lx + lw / 2, py);
      ctx.restore();
    });
  }

  destroy() {
    window.removeEventListener("keydown", this._bound.keydown);
    window.removeEventListener("keyup", this._bound.keyup);
    window.removeEventListener("mousemove", this._bound.mousemove);
    window.removeEventListener("resize", this._bound.resize);
    if (this._rafId) cancelAnimationFrame(this._rafId);
    if (this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
  }
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function CandleChart({
  candles,
  emaHighs,
  emaLows,
  signals,
  currentState,
  todayMode,
  onCrosshairMove,
  showBubble = true,
  showWaves = false,
  onWaveData,
  onResetViewReady,
  // reloadToken: counter that increments on every intentional reload.
  // Replaces the old boolean intentionalReload to avoid timing races.
  reloadToken = 0,
  onIntentionalReloadAck,
  // activeResolution: the resolution of the currently-loaded chartData.
  // Used to detect timeframe switches even when candle count is unchanged.
  activeResolution,
}) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const candleRef = useRef(null);
  const emaHiRef = useRef(null);
  const emaLoRef = useRef(null);
  const rulerRef = useRef(null);

  const isFirstLoadRef = useRef(true);
  const prevCountRef = useRef(0);
  // Track last candle's time+close to detect "only last candle updated" vs full dataset swap
  const prevLastCandleKeyRef = useRef(null);
  // true = user scrolled away from right edge → don't auto-scroll on tick
  const userScrolledRef = useRef(false);
  // Fingerprint of last marker array set — skip setMarkers when nothing changed
  const prevMarkerKeyRef = useRef(null);
  // Track last processed reloadToken value to detect new intentional reloads
  const lastProcessedTokenRef = useRef(0);
  // Track last rendered resolution to detect timeframe switches
  const prevResolutionRef = useRef(null);

  const todayModeRef = useRef(todayMode);
  const candlesRef = useRef(candles);
  const signalsRef = useRef(signals);
  const emaHighsRef = useRef(emaHighs);
  const emaLowsRef = useRef(emaLows);
  const showBubbleRef = useRef(showBubble);
  const showWavesRef = useRef(showWaves);
  const onWaveDataRef = useRef(onWaveData);
  const onIntentionalReloadAckRef = useRef(onIntentionalReloadAck);
  // intentionalReloadRef is now derived from reloadToken comparison (see data effect below)
  const intentionalReloadRef = useRef(false);

  // ── resetView ─────────────────────────────────────────────────────────────
  const resetView = useCallback(() => {
    if (!chartRef.current || !candlesRef.current?.length) return;

    const chart = chartRef.current;
    const ts = chart.timeScale();
    const candles = candlesRef.current;
    const total = candles.length;

    const barsToShow = (() => {
      if (todayModeRef.current) {
        const latestIST = toISTDate(candles.at(-1).time);
        const todayCount = candles.filter(c => toISTDate(c.time) === latestIST).length;
        return Math.max(todayCount, 20);
      }
      return Math.min(80, total);
    })();

    const lastIdx = total - 1;
    const leftBars = Math.round(barsToShow * 0.65);
    const rightBars = Math.round(barsToShow * 0.35);
    const fromIdx = Math.max(0, lastIdx - leftBars);
    const toLogical = lastIdx + rightBars;

    try {
      chart.priceScale('right').applyOptions({ autoScale: false });
      ts.setVisibleLogicalRange({ from: fromIdx, to: toLogical });
      setTimeout(() => {
        try { chart.priceScale('right').applyOptions({ autoScale: true }); } catch { }
      }, 80);
    } catch {
      try { ts.fitContent(); } catch { }
    }
  }, []);

  useEffect(() => { todayModeRef.current = todayMode; }, [todayMode]);
  useEffect(() => {
    candlesRef.current = candles;
    window.__tggCandles = candles;
  }, [candles]);
  useEffect(() => { signalsRef.current = signals; }, [signals]);
  useEffect(() => { emaHighsRef.current = emaHighs; }, [emaHighs]);
  useEffect(() => { emaLowsRef.current = emaLows; }, [emaLows]);
  useEffect(() => { showBubbleRef.current = showBubble; }, [showBubble]);
  useEffect(() => { showWavesRef.current = showWaves; }, [showWaves]);
  useEffect(() => { onWaveDataRef.current = onWaveData; }, [onWaveData]);
  useEffect(() => { onIntentionalReloadAckRef.current = onIntentionalReloadAck; }, [onIntentionalReloadAck]);
  // Sync intentionalReloadRef from reloadToken: any new token > last processed = intentional reload
  useEffect(() => {
    if (reloadToken > 0 && reloadToken !== lastProcessedTokenRef.current) {
      intentionalReloadRef.current = true;
    }
  }, [reloadToken]);

  useEffect(() => {
    if (onResetViewReady) onResetViewReady(resetView);
  }, [onResetViewReady, resetView]);

  // ── Build chart once ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: "#0a0b0f" },
        textColor: "#7a8099",
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "#1e2230" },
        horzLines: { color: "#1e2230" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "#3d84ff", width: 1, style: LineStyle.Dashed },
        horzLine: { color: "#3d84ff", width: 1, style: LineStyle.Dashed },
      },
      rightPriceScale: {
        borderColor: "#1e2230",
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor: "#1e2230",
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: (unixSec) => {
          const d = new Date((unixSec + 19800) * 1000);
          const hh = String(d.getUTCHours()).padStart(2, "0");
          const mm = String(d.getUTCMinutes()).padStart(2, "0");
          const day = String(d.getUTCDate()).padStart(2, "0");
          const mon = d.toLocaleString("en", { month: "short", timeZone: "UTC" });
          if ((hh === "00" && mm === "00") || (hh === "09" && mm === "15")) {
            return `${day} ${mon}`;
          }
          return `${hh}:${mm}`;
        },
      },
      localization: {
        timeFormatter: (unixSec) => {
          const d = new Date((unixSec + 19800) * 1000);
          const day = String(d.getUTCDate()).padStart(2, "0");
          const mon = d.toLocaleString("en", { month: "short", timeZone: "UTC" });
          const yr = String(d.getUTCFullYear()).slice(2);
          const hh = String(d.getUTCHours()).padStart(2, "0");
          const mm = String(d.getUTCMinutes()).padStart(2, "0");
          if (hh === "00" && mm === "00") return `${day} ${mon} '${yr}`;
          return `${day} ${mon} '${yr} ${hh}:${mm} IST`;
        },
      },
      handleScroll: true,
      handleScale: true,
      width: containerRef.current.clientWidth || containerRef.current.offsetWidth || 800,
      height: containerRef.current.clientHeight || containerRef.current.offsetHeight || 500,
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: "#00d97e", downColor: "#ff4560",
      borderUpColor: "#00d97e", borderDownColor: "#ff4560",
      wickUpColor: "#00d97e", wickDownColor: "#ff4560",
    });

    const emaHiSeries = chart.addLineSeries({
      color: "rgba(0,217,126,0.6)", lineWidth: 1.5, lineStyle: LineStyle.Solid,
      priceLineVisible: false, lastValueVisible: true, title: "EMA9H",
    });

    const emaLoSeries = chart.addLineSeries({
      color: "rgba(255,69,96,0.6)", lineWidth: 1.5, lineStyle: LineStyle.Solid,
      priceLineVisible: false, lastValueVisible: true, title: "EMA9L",
    });

    chartRef.current = chart;
    candleRef.current = candleSeries;
    emaHiRef.current = emaHiSeries;
    emaLoRef.current = emaLoSeries;

    rulerRef.current = new RulerOverlay(containerRef.current, chartRef, candleRef);

    createWavesIndicator(
      chart,
      containerRef.current,
      (pivots, segments) => { if (onWaveDataRef.current) onWaveDataRef.current(pivots, segments); },
      candleSeries
    );

    chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (!range) return;
      const total = candlesRef.current?.length ?? 0;
      const pinnedThreshold = 8;
      userScrolledRef.current = range.to < total - 1 - pinnedThreshold;
    });

    chart.subscribeCrosshairMove((param) => {
      if (!onCrosshairMove) return;
      if (!param.time || !param.point || param.point.x < 0 || param.point.y < 0) {
        onCrosshairMove(null); return;
      }
      const bar = param.seriesData.get(candleSeries);
      if (!bar) { onCrosshairMove(null); return; }
      onCrosshairMove({ ...bar, unixSec: param.time });
    });

    const el = containerRef.current;

    const onContextMenu = (e) => {
      e.preventDefault();
      if (e.ctrlKey) return;
      resetView();
    };
    el.addEventListener("contextmenu", onContextMenu);

    const ro = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
        rulerRef.current?._onResize();
      }
    });
    ro.observe(el);

    return () => {
      el.removeEventListener("contextmenu", onContextMenu);
      ro.disconnect();
      rulerRef.current?.destroy();
      rulerRef.current = null;
      removeWavesIndicator(true);
      chart.remove();
    };
  }, []); // eslint-disable-line

  // ── TODAY toggle ──────────────────────────────────────────────────────────
  // Only refresh markers — do NOT reshape the chart viewport.
  // resetView() is intentionally omitted here so the user's zoom/scroll is preserved.
  useEffect(() => {
    if (!candleRef.current || !candles?.length) return;
    setMarkersIfChanged(
      candleRef.current,
      showBubbleRef.current ? buildMarkers(signals, candles, todayMode) : [],
      prevMarkerKeyRef
    );
  }, [todayMode]); // eslint-disable-line

  // ── Data update ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!candleRef.current || !candles?.length) return;

    const ts = chartRef.current.timeScale();
    const isFirst = isFirstLoadRef.current;

    // Build a compact key for the last candle: "time:open:high:low:close"
    // This lets us detect "only the last candle was updated" vs a different dataset.
    const last = candles.at(-1);
    const lastKey = `${last.time}:${last.open}:${last.high}:${last.low}:${last.close}`;
    const prevCount = prevCountRef.current;
    const prevLastKey = prevLastCandleKeyRef.current;

    // ── Case 1: streaming tick — last candle updated in-place OR one new candle appended ──
    // Criteria: same count as before with last candle changed, OR count+1 with no intentional reload.
    // In both cases we do NOT do setData(), preserving the entire viewport.
    // Resolution change always forces full reload, even if candle count is same.
    const resolutionChanged =
      prevResolutionRef.current !== null &&
      activeResolution != null &&
      Number(activeResolution) !== prevResolutionRef.current;

    const isLastCandleUpdate =
      !isFirst &&
      !intentionalReloadRef.current &&
      !resolutionChanged &&
      candles.length === prevCount &&
      lastKey !== prevLastKey;

    const isNewCandleAppended =
      !isFirst &&
      !intentionalReloadRef.current &&
      !resolutionChanged &&
      candles.length === prevCount + 1;

    if (isLastCandleUpdate || isNewCandleAppended) {
      // Incremental update — never touches viewport
      const lc = {
        time: Math.floor(last.time / 1000),
        open: last.open, high: last.high, low: last.low, close: last.close,
      };
      candleRef.current.update(lc);

      const i = candles.length - 1;
      if (emaHighs[i] != null && !isNaN(emaHighs[i]))
        emaHiRef.current.update({ time: lc.time, value: emaHighs[i] });
      if (emaLows[i] != null && !isNaN(emaLows[i]))
        emaLoRef.current.update({ time: lc.time, value: emaLows[i] });

      // Only update signals markers if something actually changed
      // (skip on pure OHLC tick to avoid any flicker)
      if (isNewCandleAppended && showBubbleRef.current) {
        setMarkersIfChanged(
          candleRef.current,
          buildMarkers(signalsRef.current, candles, todayModeRef.current),
          prevMarkerKeyRef
        );
      }

      if (showWavesRef.current) updateWavesIndicator(candles, emaHighs, emaLows);
      prevCountRef.current = candles.length;
      prevLastCandleKeyRef.current = lastKey;
      // Update tracked resolution (even on incremental updates)
      if (activeResolution != null) prevResolutionRef.current = Number(activeResolution);

      // Auto-scroll only if user is pinned to right edge
      if (!userScrolledRef.current) {
        try {
          const range = ts.getVisibleLogicalRange();
          if (range && isNewCandleAppended) {
            ts.setVisibleLogicalRange({ from: range.from + 1, to: range.to + 1 });
          }
        } catch { }
      }
      return;
    }

    // ── Case 2: full reload (first load, intentional symbol/TF/manual refresh, or large data diff) ──
    // Save viewport BEFORE setData so we can restore it after if needed.
    const savedRange = isFirst ? null : (() => {
      try { return ts.getVisibleLogicalRange(); } catch { return null; }
    })();

    const isIntentional = intentionalReloadRef.current;

    candleRef.current.setData(
      candles.map((c) => ({
        time: Math.floor(c.time / 1000),
        open: c.open, high: c.high, low: c.low, close: c.close,
      }))
    );
    emaHiRef.current.setData(
      candles.map((c, i) => ({ time: Math.floor(c.time / 1000), value: emaHighs[i] }))
        .filter((d) => d.value != null && !isNaN(d.value))
    );
    emaLoRef.current.setData(
      candles.map((c, i) => ({ time: Math.floor(c.time / 1000), value: emaLows[i] }))
        .filter((d) => d.value != null && !isNaN(d.value))
    );

    if (showWavesRef.current) updateWavesIndicator(candles, emaHighs, emaLows);
    else removeWavesIndicator();

    setMarkersIfChanged(
      candleRef.current,
      showBubbleRef.current ? buildMarkers(signals, candles, todayModeRef.current) : [],
      prevMarkerKeyRef
    );

    prevCountRef.current = candles.length;
    prevLastCandleKeyRef.current = lastKey;

    // Always update tracked resolution after a full reload
    if (activeResolution != null) prevResolutionRef.current = Number(activeResolution);

    if (isFirst) {
      isFirstLoadRef.current = false;
      intentionalReloadRef.current = false;
      lastProcessedTokenRef.current = reloadToken;
      userScrolledRef.current = false;
      if (onIntentionalReloadAckRef.current) onIntentionalReloadAckRef.current();
      resetView();
    } else if (isIntentional || resolutionChanged) {
      // User explicitly changed symbol / timeframe / clicked Refresh
      intentionalReloadRef.current = false;
      lastProcessedTokenRef.current = reloadToken;
      userScrolledRef.current = false;
      if (onIntentionalReloadAckRef.current) onIntentionalReloadAckRef.current();
      resetView();
    } else {
      // Background auto-refresh with same timeframe but larger-than-tick diff
      // (e.g. historical fill or initial socket push with more candles).
      // Restore the exact viewport the user was looking at.
      if (savedRange) {
        // Use setTimeout(0) so lightweight-charts finishes its internal layout
        // before we force the range back — prevents the "jump to left" artifact.
        setTimeout(() => {
          try {
            chartRef.current?.timeScale().setVisibleLogicalRange(savedRange);
          } catch {
            resetView();
          }
        }, 0);
      } else {
        resetView();
      }
    }
  }, [candles, emaHighs, emaLows, signals]); // eslint-disable-line

  // ── Bubble toggle ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!candleRef.current || !candlesRef.current?.length) return;
    setMarkersIfChanged(
      candleRef.current,
      showBubble ? buildMarkers(signalsRef.current, candlesRef.current, todayModeRef.current) : [],
      prevMarkerKeyRef
    );
  }, [showBubble]); // eslint-disable-line

  // ── Waves toggle ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!chartRef.current) return;
    if (showWaves) {
      if (candlesRef.current?.length)
        updateWavesIndicator(candlesRef.current, emaHighsRef.current, emaLowsRef.current);
    } else {
      removeWavesIndicator();
    }
    if (candleRef.current && candlesRef.current?.length) {
      setMarkersIfChanged(
        candleRef.current,
        showBubbleRef.current
          ? buildMarkers(signalsRef.current, candlesRef.current, todayModeRef.current)
          : [],
        prevMarkerKeyRef
      );
    }
  }, [showWaves]); // eslint-disable-line

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />

      {/* Hint labels */}
      <div style={{
        position: "absolute", bottom: 36, left: 12,
        color: "#4a5270", fontSize: 10, fontFamily: "var(--font-mono)",
        pointerEvents: "none", userSelect: "none",
        display: "flex", gap: 16,
      }}>
        <span>Right-click → latest candle</span>
        <span style={{ color: "#3a4060" }}>Hold Ctrl to measure</span>
      </div>
    </div>
  );
}