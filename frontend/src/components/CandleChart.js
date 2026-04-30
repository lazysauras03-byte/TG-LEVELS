import React, { useEffect, useRef, useCallback } from "react";
import { createChart, CrosshairMode, LineStyle } from "lightweight-charts";

const STATE_LABELS = {
  0: { label: "WAIT", color: "#7a8099" },
  1: { label: "TRACK HIGH ↑", color: "#00d97e" },
  "-1": { label: "TRACK LOW ↓", color: "#ff4560" },
  2: { label: "TRAIL LOW (post NH)", color: "#ffc135" },
  "-2": { label: "TRAIL HIGH (post NL)", color: "#3d84ff" },
};

export default function CandleChart({ candles, emaHighs, emaLows, signals, currentState }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const candleSeriesRef = useRef(null);
  const emaHighSeriesRef = useRef(null);
  const emaLowSeriesRef = useRef(null);

  // ── Build chart once ────────────────────────────────────────────
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
      },
      handleScroll: true,
      handleScale: true,
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
    });

    // Candlestick series
    const candleSeries = chart.addCandlestickSeries({
      upColor: "#00d97e",
      downColor: "#ff4560",
      borderUpColor: "#00d97e",
      borderDownColor: "#ff4560",
      wickUpColor: "#00d97e",
      wickDownColor: "#ff4560",
    });

    // EMA High (green)
    const emaHighSeries = chart.addLineSeries({
      color: "rgba(0, 217, 126, 0.6)",
      lineWidth: 1.5,
      lineStyle: LineStyle.Solid,
      priceLineVisible: false,
      lastValueVisible: true,
      title: "EMA9H",
    });

    // EMA Low (red)
    const emaLowSeries = chart.addLineSeries({
      color: "rgba(255, 69, 96, 0.6)",
      lineWidth: 1.5,
      lineStyle: LineStyle.Solid,
      priceLineVisible: false,
      lastValueVisible: true,
      title: "EMA9L",
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    emaHighSeriesRef.current = emaHighSeries;
    emaLowSeriesRef.current = emaLowSeries;

    // Resize observer
    const ro = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, []);

  // ── Update data when props change ───────────────────────────────
  useEffect(() => {
    if (!candleSeriesRef.current || !candles || candles.length === 0) return;

    const candleData = candles.map((c) => ({
      time: Math.floor(c.time / 1000),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    const emaHighData = candles.map((c, i) => ({
      time: Math.floor(c.time / 1000),
      value: emaHighs[i],
    })).filter((d) => d.value != null && !isNaN(d.value));

    const emaLowData = candles.map((c, i) => ({
      time: Math.floor(c.time / 1000),
      value: emaLows[i],
    })).filter((d) => d.value != null && !isNaN(d.value));

    candleSeriesRef.current.setData(candleData);
    emaHighSeriesRef.current.setData(emaHighData);
    emaLowSeriesRef.current.setData(emaLowData);

    // ── Markers for NH / NL / BC ─────────────────────────────────
    const markers = [];

    if (signals && signals.length > 0) {
      // Group by (time, barIndex) to avoid duplicates
      const added = new Set();

      signals.forEach((sig) => {
        const t = Math.floor(sig.time / 1000);
        const key = `${sig.type}-${t}`;
        if (added.has(key)) return;
        added.add(key);

        switch (sig.type) {
          case "NH":
            markers.push({
              time: t,
              position: "aboveBar",
              color: "#00d97e",
              shape: "arrowDown",
              text: "NH",
              size: 1,
            });
            break;
          case "NL":
            markers.push({
              time: t,
              position: "belowBar",
              color: "#ff4560",
              shape: "arrowUp",
              text: "NL",
              size: 1,
            });
            break;
          case "BC_HIGH":
            markers.push({
              time: t,
              position: "aboveBar",
              color: "#ffc135",
              shape: "arrowDown",
              text: "BC",
              size: 1,
            });
            break;
          case "BC_LOW":
            markers.push({
              time: t,
              position: "belowBar",
              color: "#ffc135",
              shape: "arrowUp",
              text: "BC",
              size: 1,
            });
            break;
          default:
            break;
        }
      });

      // Sort by time (required by lightweight-charts)
      markers.sort((a, b) => a.time - b.time);
    }

    candleSeriesRef.current.setMarkers(markers);
    chartRef.current.timeScale().fitContent();
  }, [candles, emaHighs, emaLows, signals]);

  const stateInfo = STATE_LABELS[String(currentState)] || STATE_LABELS[0];

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
      {/* State badge overlay */}
      <div
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          background: "rgba(10,11,15,0.85)",
          border: `1px solid ${stateInfo.color}33`,
          borderRadius: 6,
          padding: "4px 10px",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: stateInfo.color,
          backdropFilter: "blur(4px)",
          pointerEvents: "none",
        }}
      >
        STATE: {stateInfo.label}
      </div>
    </div>
  );
}
