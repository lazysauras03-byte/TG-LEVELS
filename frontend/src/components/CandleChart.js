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

  const isFirstLoadRef = useRef(true);
  const prevCountRef = useRef(0);
  // true  = user has scrolled away from the right edge → don't auto-scroll on tick
  // false = user is pinned to right (default) → follow new candles
  const userScrolledRef = useRef(false);
  // tracks the last intentional reload key so we can distinguish tick vs reload
  const prevReloadKeyRef = useRef("");

  const todayModeRef = useRef(todayMode);
  const candlesRef = useRef(candles);
  const signalsRef = useRef(signals);
  const emaHighsRef = useRef(emaHighs);
  const emaLowsRef = useRef(emaLows);
  const showBubbleRef = useRef(showBubble);
  const showWavesRef = useRef(showWaves);
  const onWaveDataRef = useRef(onWaveData);
  const intentionalReloadRef = useRef(intentionalReload);

  const resetView = useCallback(() => {
    if (!chartRef.current || !candlesRef.current?.length) return;
    const ts = chartRef.current.timeScale();
    try {
      const total = candlesRef.current.length;
      const barsToShow = todayModeRef.current
        ? (() => {
          const latestIST = toISTDate(candlesRef.current.at(-1).time);
          const todayCount = candlesRef.current.filter((c) => toISTDate(c.time) === latestIST).length;
          return Math.max(todayCount, 20);
        })()
        : 120;
      const rightOffset = 5;
      const to = total - 1 + rightOffset;
      const from = to - barsToShow - rightOffset;
      ts.setVisibleLogicalRange({ from, to });
    } catch {
      try { ts.scrollToRealTime(); } catch { ts.fitContent(); }
    }
  }, []);

  useEffect(() => { todayModeRef.current = todayMode; }, [todayMode]);
  useEffect(() => { candlesRef.current = candles; }, [candles]);
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
          if (hh === "09" && mm === "15") {
            const day = String(d.getUTCDate()).padStart(2, "0");
            const mon = d.toLocaleString("en", { month: "short", timeZone: "UTC" });
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

    // Pass wave data callback + candleSeries into WavesIndicator.
    // candleSeries is required for priceToCoordinate() in lightweight-charts v4
    // (the method lives on ISeriesApi, not on IPriceScaleApi).
    createWavesIndicator(
      chart,
      containerRef.current,
      (pivots, segments) => { if (onWaveDataRef.current) onWaveDataRef.current(pivots, segments); },
      candleSeries
    );

    // Track whether the user has scrolled away from the right edge.
    // lightweight-charts fires visibleLogicalRangeChanged on every pan/zoom.
    // We compare the right edge of the visible range against total bar count:
    // if the user can see the last candle (right edge >= total-2), they're "pinned".
    chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (!range) return;
      const total = candlesRef.current?.length ?? 0;
      // "pinned" = right edge is within 8 bars of the last candle
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
    const onContextMenu = (e) => { e.preventDefault(); resetView(); };
    el.addEventListener("contextmenu", onContextMenu);

    const ro = new ResizeObserver(() => {
      if (containerRef.current)
        chart.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
    });
    ro.observe(el);

    return () => {
      el.removeEventListener("contextmenu", onContextMenu);
      ro.disconnect();
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
    // Everything else (symbol change, timeframe change, refresh) = full reload.
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

      // Only follow the new candle if user is still pinned to the right edge.
      // If they've scrolled back to study history → don't touch their viewport.
      if (!userScrolledRef.current) {
        try {
          const range = ts.getVisibleLogicalRange();
          if (range) {
            // Shift the window one bar to the right to follow the new candle
            ts.setVisibleLogicalRange({ from: range.from + 1, to: range.to + 1 });
          }
        } catch { /* ignore */ }
      }
      return;
    }

    // ── Full reload (first load / symbol / timeframe / manual refresh) ────
    // Save current viewport so we can restore it after setData() resets it,
    // but only if this is NOT the first load and NOT an intentional reload
    // triggered by the user changing symbol/timeframe (those should right-anchor).
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

    // Set markers AFTER wave line series are added — adding new series to the
    // chart can reset markers on the candlestick series in lightweight-charts.
    candleRef.current.setMarkers(
      showBubbleRef.current ? buildMarkers(signals, candles, todayModeRef.current) : []
    );

    prevCountRef.current = candles.length;

    if (isFirst) {
      // Very first load → right-anchor
      isFirstLoadRef.current = false;
      userScrolledRef.current = false;
      resetView();
    } else if (intentionalReloadRef.current) {
      // User deliberately changed symbol / timeframe / hit Refresh → right-anchor
      intentionalReloadRef.current = false;   // consume the flag
      userScrolledRef.current = false;
      resetView();
    } else if (savedRange) {
      // Background auto-refresh (same symbol+timeframe, socket pushed new data) →
      // restore exactly what the user was looking at
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
    // Re-apply markers after wave line series are added/removed — adding or
    // removing series in lightweight-charts can reset markers on the candlestick series.
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
      <div style={{
        position: "absolute", bottom: 36, left: 12,
        color: "#3a4060", fontSize: 10, fontFamily: "var(--font-mono)",
        pointerEvents: "none", userSelect: "none",
      }}>
        Right-click to reset view
      </div>
    </div>
  );
}