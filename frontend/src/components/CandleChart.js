import React, { useEffect, useRef, useCallback } from "react";
import { createChart, CrosshairMode, LineStyle } from "lightweight-charts";

// Convert unix-ms → IST date string  e.g. "30/04/2026"
function toISTDate(tsMs) {
  return new Date(tsMs).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
}

// Build marker array from signals filtered by todayMode
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

export default function CandleChart({
  candles, emaHighs, emaLows, signals, currentState,
  todayMode,
  onCrosshairMove,
  // Bubble Indicator: NH / NL / BC markers — controlled by IndicatorPanel
  showBubble = true,
}) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const candleRef = useRef(null);
  const emaHiRef = useRef(null);
  const emaLoRef = useRef(null);

  const isFirstLoadRef = useRef(true);
  const prevCountRef = useRef(0);

  // Always-current refs — used inside effects that have empty/minimal deps
  // so they never read stale closure values
  const todayModeRef = useRef(todayMode);
  const candlesRef = useRef(candles);
  const signalsRef = useRef(signals);
  const showBubbleRef = useRef(showBubble);

  // Keep every ref in sync with the latest prop value
  useEffect(() => { todayModeRef.current = todayMode; }, [todayMode]);
  useEffect(() => { candlesRef.current = candles; }, [candles]);
  useEffect(() => { signalsRef.current = signals; }, [signals]);
  useEffect(() => { showBubbleRef.current = showBubble; }, [showBubble]);

  // ── Reset view — TradingView style ────────────────────────────────────────
  const resetView = useCallback(() => {
    if (!chartRef.current || !candlesRef.current?.length) return;
    const ts = chartRef.current.timeScale();
    if (todayModeRef.current) {
      const latestIST = toISTDate(candlesRef.current.at(-1).time);
      const todayC = candlesRef.current.filter((c) => toISTDate(c.time) === latestIST);
      if (todayC.length > 0) {
        const from = Math.floor(todayC[0].time / 1000) - 120;
        const to = Math.floor(todayC.at(-1).time / 1000) + 900;
        try { ts.setVisibleRange({ from, to }); } catch { ts.fitContent(); }
        return;
      }
    }
    ts.fitContent();
  }, []);

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

    // Crosshair → OHLC in navbar
    chart.subscribeCrosshairMove((param) => {
      if (!onCrosshairMove) return;
      if (!param.time || !param.point || param.point.x < 0 || param.point.y < 0) {
        onCrosshairMove(null); return;
      }
      const bar = param.seriesData.get(candleSeries);
      if (!bar) { onCrosshairMove(null); return; }
      onCrosshairMove({ ...bar, unixSec: param.time });
    });

    // Right-click → reset view
    const el = containerRef.current;
    const onContextMenu = (e) => { e.preventDefault(); resetView(); };
    el.addEventListener("contextmenu", onContextMenu);

    // Double-click → reset view
    const onDblClick = () => resetView();
    el.addEventListener("dblclick", onDblClick);

    // Resize observer
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
      el.removeEventListener("dblclick", onDblClick);
      ro.disconnect();
      chart.remove();
    };
  }, []); // eslint-disable-line

  // ── TODAY toggle → update markers + zoom ─────────────────────────────────
  useEffect(() => {
    if (!candleRef.current || !candles?.length) return;
    // Always read showBubbleRef so this works regardless of toggle state
    const markers = showBubbleRef.current
      ? buildMarkers(signals, candles, todayMode)
      : [];
    candleRef.current.setMarkers(markers);
    resetView();
  }, [todayMode]); // eslint-disable-line

  // ── Data update (new candles / refresh / symbol / timeframe change) ───────
  useEffect(() => {
    if (!candleRef.current || !candles?.length) return;

    const ts = chartRef.current.timeScale();
    const isFirst = isFirstLoadRef.current;
    const isNewCandle = !isFirst && candles.length === prevCountRef.current + 1;

    if (isNewCandle) {
      // Streaming tick — don't disturb scroll
      const latest = candles.at(-1);
      const lc = {
        time: Math.floor(latest.time / 1000),
        open: latest.open,
        high: latest.high,
        low: latest.low,
        close: latest.close,
      };
      candleRef.current.update(lc);
      const i = candles.length - 1;
      if (emaHighs[i] != null && !isNaN(emaHighs[i]))
        emaHiRef.current.update({ time: lc.time, value: emaHighs[i] });
      if (emaLows[i] != null && !isNaN(emaLows[i]))
        emaLoRef.current.update({ time: lc.time, value: emaLows[i] });
      prevCountRef.current = candles.length;
      return;
    }

    // Full reload (symbol change, timeframe change, manual refresh, first load)
    const savedRange = isFirst ? null : ts.getVisibleLogicalRange();

    const allData = candles.map((c) => ({
      time: Math.floor(c.time / 1000),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    candleRef.current.setData(allData);
    emaHiRef.current.setData(
      candles
        .map((c, i) => ({ time: Math.floor(c.time / 1000), value: emaHighs[i] }))
        .filter((d) => d.value != null && !isNaN(d.value))
    );
    emaLoRef.current.setData(
      candles
        .map((c, i) => ({ time: Math.floor(c.time / 1000), value: emaLows[i] }))
        .filter((d) => d.value != null && !isNaN(d.value))
    );

    // Use the REF here — not the closure prop — so the current toggle state
    // is always respected even when this effect fires on timeframe/symbol change
    candleRef.current.setMarkers(
      showBubbleRef.current
        ? buildMarkers(signals, candles, todayModeRef.current)
        : []
    );

    prevCountRef.current = candles.length;

    if (isFirst) {
      isFirstLoadRef.current = false;
      resetView();
    } else if (savedRange) {
      setTimeout(() => {
        try { chartRef.current?.timeScale().setVisibleLogicalRange(savedRange); }
        catch { chartRef.current?.timeScale().fitContent(); }
      }, 0);
    } else {
      resetView();
    }

  }, [candles, emaHighs, emaLows, signals]); // eslint-disable-line

  // ── Bubble indicator toggle — instant show/hide without reloading data ────
  // This fires whenever the toggle changes. Because we always read from refs
  // in the data-update effect above, toggling here is the ONLY thing that
  // controls marker visibility.
  useEffect(() => {
    if (!candleRef.current || !candlesRef.current?.length) return;
    const markers = showBubble
      ? buildMarkers(signalsRef.current, candlesRef.current, todayModeRef.current)
      : [];
    candleRef.current.setMarkers(markers);
  }, [showBubble]); // eslint-disable-line

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
      <div style={{
        position: "absolute", bottom: 36, left: 12,
        color: "#3a4060", fontSize: 10,
        fontFamily: "var(--font-mono)",
        pointerEvents: "none", userSelect: "none",
      }}>
        Right-click or double-click to reset view
      </div>
    </div>
  );
}