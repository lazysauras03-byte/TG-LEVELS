// CandleChart.js
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

// ─── Ruler overlay ────────────────────────────────────────────────────────────
// Draws a TradingView-style measurement ruler on a Canvas overlay.
// Activated by holding Ctrl and dragging. Shows: bars, Δ price, Δ%, time range.

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
    this.active = false;   // Ctrl is held
    this.startPt = null;    // locked when Ctrl first pressed, in canvas px
    this.endPt = null;    // follows mouse while Ctrl held
    this._lastMouse = null;  // last known mouse position

    this._rafId = null;
    this._bound = {
      keydown: this._onKeyDown.bind(this),
      keyup: this._onKeyUp.bind(this),
      mousemove: this._onMouseMove.bind(this),
      resize: this._onResize.bind(this),
    };

    window.addEventListener("keydown", this._bound.keydown);
    window.addEventListener("keyup", this._bound.keyup);
    // Track mouse position globally so we know where to anchor when Ctrl is pressed
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
    // Lock start point to wherever the mouse is RIGHT NOW
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
    // Always track last known position (so Ctrl-press can anchor here)
    const pt = this._rel(e);
    this._lastMouse = pt;
    if (!this.active) return;
    // If somehow startPt wasn't set (mouse entered after Ctrl), set it now
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

  // Convert canvas-px X → unix seconds using the chart time scale
  _xToTime(x) {
    try {
      return this.chartRef.current?.timeScale().coordinateToTime(x);
    } catch { return null; }
  }

  // Convert canvas-px Y → price using the candle series
  _yToPrice(y) {
    try {
      return this.candleSeriesRef.current?.coordinateToPrice(y);
    } catch { return null; }
  }

  // Find the candle closest to a unix-seconds timestamp
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

    // ── Resolve prices & times ────────────────────────────────────────────
    const t1 = this._xToTime(startPt.x);
    const t2 = this._xToTime(endPt.x);
    const p1 = this._yToPrice(startPt.y);
    const p2 = this._yToPrice(endPt.y);

    if (p1 == null || p2 == null) return;

    const x1 = startPt.x, y1 = startPt.y;
    const x2 = endPt.x, y2 = endPt.y;

    // ── Colors matching app UI ────────────────────────────────────────────
    const isBull = p2 >= p1;
    const clrLine = isBull ? "rgba(0,217,126,0.85)" : "rgba(255,69,96,0.85)";
    const clrFill = isBull ? "rgba(0,217,126,0.08)" : "rgba(255,69,96,0.08)";
    const clrBox = isBull ? "rgba(0,217,126,0.18)" : "rgba(255,69,96,0.18)";
    const clrTxt = "#e4e8f5";
    const clrMute = "#7a8099";
    const clrBg = "rgba(14,16,26,0.92)";
    const clrBdr = isBull ? "rgba(0,217,126,0.55)" : "rgba(255,69,96,0.55)";

    // ── Draw filled rectangle ─────────────────────────────────────────────
    ctx.fillStyle = clrFill;
    ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));

    // Horizontal midline
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

    // Vertical borders
    [x1, x2].forEach((x) => {
      ctx.strokeStyle = clrLine;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x, Math.min(y1, y2));
      ctx.lineTo(x, Math.max(y1, y2));
      ctx.stroke();
    });

    // Horizontal borders
    [y1, y2].forEach((y) => {
      ctx.strokeStyle = clrLine;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(Math.min(x1, x2), y);
      ctx.lineTo(Math.max(x1, x2), y);
      ctx.stroke();
    });

    // Corner dots
    [[x1, y1], [x2, y1], [x1, y2], [x2, y2]].forEach(([cx, cy]) => {
      ctx.fillStyle = clrLine;
      ctx.beginPath();
      ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();

    // Diagonal measurement line
    ctx.save();
    ctx.strokeStyle = clrLine;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();

    // ── Compute stats ─────────────────────────────────────────────────────
    const dPrice = p2 - p1;
    const dPct = p1 !== 0 ? (dPrice / Math.abs(p1)) * 100 : 0;
    const sign = dPrice >= 0 ? "+" : "";

    // Bar count from time
    let barCount = 0;
    if (t1 != null && t2 != null) {
      const allCandles = window.__tggCandles || [];
      const idx1 = allCandles.findIndex((c) => Math.floor(c.time / 1000) >= Math.min(t1, t2));
      const idx2 = allCandles.findIndex((c) => Math.floor(c.time / 1000) >= Math.max(t1, t2));
      barCount = Math.abs((idx2 < 0 ? allCandles.length : idx2) - (idx1 < 0 ? 0 : idx1));
    }

    // Time label (IST)
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

    // ── Info tooltip ──────────────────────────────────────────────────────
    const lines = [
      { label: "Δ Price", value: `${sign}${numFmt.format(dPrice)}`, color: clrLine },
      { label: "Δ %", value: `${sign}${Math.abs(dPct).toFixed(2)}%`, color: clrLine },
      { label: "Bars", value: String(barCount), color: clrMute },
      { label: "From", value: fmtIST(Math.min(t1 ?? 0, t2 ?? 0)), color: clrMute },
      { label: "To", value: fmtIST(Math.max(t1 ?? 0, t2 ?? 0)), color: clrMute },
    ];

    const padding = 10;
    const lineH = 18;
    const labelW = 56;
    const boxW = 178;
    const boxH = lines.length * lineH + padding * 2;

    // Position tooltip so it stays inside canvas
    let tipX = Math.max(x1, x2) + 12;
    let tipY = (y1 + y2) / 2 - boxH / 2;
    if (tipX + boxW > W - 8) tipX = Math.min(x1, x2) - boxW - 12;
    if (tipX < 8) tipX = 8;
    if (tipY < 8) tipY = 8;
    if (tipY + boxH > H - 8) tipY = H - boxH - 8;

    // Background
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

    // Lines
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

    // ── Price labels on right edge ─────────────────────────────────────────
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
  onWaveData,           // (pivots, segments) => void
  onResetViewReady,     // (resetFn) => void — called once so parent can trigger right-anchor
  intentionalReload,    // boolean — true when parent triggered symbol/timeframe/refresh change
}) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const candleRef = useRef(null);
  const emaHiRef = useRef(null);
  const emaLoRef = useRef(null);
  const rulerRef = useRef(null);

  const isFirstLoadRef = useRef(true);
  const prevCountRef = useRef(0);
  // true  = user has scrolled away from the right edge → don't auto-scroll on tick
  // false = user is pinned to right (default) → follow new candles
  const userScrolledRef = useRef(false);

  const todayModeRef = useRef(todayMode);
  const candlesRef = useRef(candles);
  const signalsRef = useRef(signals);
  const emaHighsRef = useRef(emaHighs);
  const emaLowsRef = useRef(emaLows);
  const showBubbleRef = useRef(showBubble);
  const showWavesRef = useRef(showWaves);
  const onWaveDataRef = useRef(onWaveData);
  const intentionalReloadRef = useRef(intentionalReload);

  // ── resetView ────────────────────────────────────────────────────────────────
  // RIGHT-CLICK behaviour: ALWAYS jump to the latest candle with a fixed,
  // comfortable bar window. No zoom preservation — that's what caused candles
  // to appear as tiny dots when the user was zoomed out.
  //
  // TODAY mode  → show all of today's candles + 10 right-margin bars
  // Normal mode → show last 80 bars + 10 right-margin bars (fills the screen
  //               nicely at any timeframe without being too crowded)
  const resetView = useCallback(() => {
    if (!chartRef.current || !candlesRef.current?.length) return;
    const ts = chartRef.current.timeScale();
    const total = candlesRef.current.length;
    const RIGHT_MARGIN = 10;

    const barsToShow = (() => {
      if (todayModeRef.current) {
        const latestIST = toISTDate(candlesRef.current.at(-1).time);
        const todayCount = candlesRef.current.filter(
          (c) => toISTDate(c.time) === latestIST
        ).length;
        return Math.max(todayCount, 20); // show full day, min 20 bars
      }
      return 80; // fixed comfortable window for any non-TODAY timeframe
    })();

    try {
      const to = total - 1 + RIGHT_MARGIN;
      const from = to - barsToShow - RIGHT_MARGIN;
      ts.setVisibleLogicalRange({ from, to });
    } catch {
      try { ts.scrollToRealTime(); } catch { ts.fitContent(); }
    }
  }, []);

  useEffect(() => { todayModeRef.current = todayMode; }, [todayMode]);
  useEffect(() => {
    candlesRef.current = candles;
    // Keep global reference for the ruler's bar-count calculation
    window.__tggCandles = candles;
  }, [candles]);
  useEffect(() => { signalsRef.current = signals; }, [signals]);
  useEffect(() => { emaHighsRef.current = emaHighs; }, [emaHighs]);
  useEffect(() => { emaLowsRef.current = emaLows; }, [emaLows]);
  useEffect(() => { showBubbleRef.current = showBubble; }, [showBubble]);
  useEffect(() => { showWavesRef.current = showWaves; }, [showWaves]);
  useEffect(() => { onWaveDataRef.current = onWaveData; }, [onWaveData]);
  useEffect(() => { intentionalReloadRef.current = intentionalReload; }, [intentionalReload]);

  // Expose resetView to parent so it can call it on intentional symbol/timeframe changes
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
          // Daily candles open at 09:15 IST; intraday session starts at 09:15 too.
          // If time is midnight UTC+5:30 (i.e. 00:00 IST) it's a daily bar → show date only.
          // Also show date at the start of each trading day (09:15).
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
          // Daily bar: time is midnight IST (00:00) — show date only
          if (hh === "00" && mm === "00") return `${day} ${mon} '${yr}`;
          return `${day} ${mon} '${yr} ${hh}:${mm} IST`;
        },
      },
      handleScroll: true,
      handleScale: true,
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
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

    // Create ruler overlay (needs refs for coordinateToPrice/Time)
    rulerRef.current = new RulerOverlay(containerRef.current, chartRef, candleRef);

    // Pass wave data callback + candleSeries into WavesIndicator.
    createWavesIndicator(
      chart,
      containerRef.current,
      (pivots, segments) => { if (onWaveDataRef.current) onWaveDataRef.current(pivots, segments); },
      candleSeries
    );

    // Track whether the user has scrolled away from the right edge
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

    // Right-click → scroll to latest candle, PRESERVE current zoom width
    const onContextMenu = (e) => {
      e.preventDefault();
      // Don't reset if Ctrl is held (ruler might be active)
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
  useEffect(() => {
    if (!candleRef.current || !candles?.length) return;
    candleRef.current.setMarkers(
      showBubbleRef.current ? buildMarkers(signals, candles, todayMode) : []
    );
    resetView();
  }, [todayMode]); // eslint-disable-line

  // ── Data update ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!candleRef.current || !candles?.length) return;

    const ts = chartRef.current.timeScale();
    const isFirst = isFirstLoadRef.current;

    // A "tick" = one new candle appended, nothing else changed.
    const isNewCandle = !isFirst && candles.length === prevCountRef.current + 1;

    // ── Streaming tick: preserve user's viewport exactly ─────────────────
    if (isNewCandle) {
      const latest = candles.at(-1);
      const lc = {
        time: Math.floor(latest.time / 1000),
        open: latest.open, high: latest.high, low: latest.low, close: latest.close,
      };
      candleRef.current.update(lc);

      const i = candles.length - 1;
      if (emaHighs[i] != null && !isNaN(emaHighs[i]))
        emaHiRef.current.update({ time: lc.time, value: emaHighs[i] });
      if (emaLows[i] != null && !isNaN(emaLows[i]))
        emaLoRef.current.update({ time: lc.time, value: emaLows[i] });

      if (showWavesRef.current) updateWavesIndicator(candles, emaHighs, emaLows);
      prevCountRef.current = candles.length;

      if (!userScrolledRef.current) {
        try {
          const range = ts.getVisibleLogicalRange();
          if (range) {
            ts.setVisibleLogicalRange({ from: range.from + 1, to: range.to + 1 });
          }
        } catch { /* ignore */ }
      }
      return;
    }

    // ── Full reload (first load / symbol / timeframe / manual refresh) ────
    const savedRange = isFirst ? null : ts.getVisibleLogicalRange();

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

    candleRef.current.setMarkers(
      showBubbleRef.current ? buildMarkers(signals, candles, todayModeRef.current) : []
    );

    prevCountRef.current = candles.length;

    if (isFirst) {
      isFirstLoadRef.current = false;
      userScrolledRef.current = false;
      resetView();
    } else if (intentionalReloadRef.current) {
      intentionalReloadRef.current = false;
      userScrolledRef.current = false;
      resetView();
    } else if (savedRange) {
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
  }, [candles, emaHighs, emaLows, signals]); // eslint-disable-line

  // ── Bubble toggle ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!candleRef.current || !candlesRef.current?.length) return;
    candleRef.current.setMarkers(
      showBubble ? buildMarkers(signalsRef.current, candlesRef.current, todayModeRef.current) : []
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
      candleRef.current.setMarkers(
        showBubbleRef.current
          ? buildMarkers(signalsRef.current, candlesRef.current, todayModeRef.current)
          : []
      );
    }
  }, [showWaves]); // eslint-disable-line

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />

      {/* Hint labels */}
      <div style={{
        position: "absolute", bottom: 36, left: 12,
        color: "#3a4060", fontSize: 10, fontFamily: "var(--font-mono)",
        pointerEvents: "none", userSelect: "none",
        display: "flex", gap: 16,
      }}>
        <span>Right-click to go to latest</span>
        <span style={{ color: "#2a3050" }}>Hold Ctrl to measure</span>
      </div>
    </div>
  );
}