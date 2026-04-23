// TradingChart.jsx
import { useEffect, useRef } from "react";
import { createChart, CrosshairMode, LineStyle } from "lightweight-charts";

const SIGNAL_STYLES = {
  FIRST_HIGH: { color: "#f59e0b", shape: "circle", position: "aboveBar", size: 2 },
  FIRST_LOW: { color: "#f59e0b", shape: "circle", position: "belowBar", size: 2 },
  NEW_HIGH: { color: "#22c55e", shape: "circle", position: "aboveBar", size: 1.5 },
  NEW_LOW: { color: "#ef4444", shape: "circle", position: "belowBar", size: 1.5 },
  LAST_HIGH: { color: "#f59e0b", shape: "circle", position: "aboveBar", size: 2 },
  LAST_LOW: { color: "#f59e0b", shape: "circle", position: "belowBar", size: 2 },
};

const TYPE_LABEL = {
  FIRST_HIGH: "FH", FIRST_LOW: "FL",
  NEW_HIGH: "NH", NEW_LOW: "NL",
  LAST_HIGH: "LH", LAST_LOW: "LL",
};

// IST offset in seconds
const IST_OFFSET = 19800;

function tsToISTDate(ts) {
  const d = new Date((ts + IST_OFFSET) * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export default function TradingChart({ data, showEMA9High, showEMA9Low, showEMA9Close, onCrosshairMove, todayMode }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef({});
  const candleTimesRef = useRef([]);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
      layout: {
        background: { color: "#0a0e1a" },
        textColor: "#8899bb",
        fontSize: 11,
        fontFamily: "'JetBrains Mono', monospace",
      },
      grid: {
        vertLines: { color: "#0f1929" },
        horzLines: { color: "#0f1929" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "#3b82f6", width: 1, style: LineStyle.Dashed, labelBackgroundColor: "#1e3a8a" },
        horzLine: { color: "#3b82f6", width: 1, style: LineStyle.Dashed, labelBackgroundColor: "#1e3a8a" },
      },
      rightPriceScale: {
        borderColor: "#1e2d4a",
        scaleMargins: { top: 0.08, bottom: 0.25 },
      },
      timeScale: {
        borderColor: "#1e2d4a",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 12,
        barSpacing: 8,
        tickMarkFormatter: (time) => {
          const d = new Date((time + IST_OFFSET) * 1000);
          const h = String(d.getUTCHours()).padStart(2, "0");
          const m = String(d.getUTCMinutes()).padStart(2, "0");
          return `${h}:${m}`;
        },
      },
      localization: {
        timeFormatter: (time) => {
          const d = new Date((time + IST_OFFSET) * 1000);
          const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
          const dy = String(d.getUTCDate()).padStart(2, "0");
          const h = String(d.getUTCHours()).padStart(2, "0");
          const mi = String(d.getUTCMinutes()).padStart(2, "0");
          return `${dy}/${mo} ${h}:${mi} IST`;
        },
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true },
      handleScale: { mouseWheel: true, pinch: true },
    });
    chartRef.current = chart;

    // Candles
    const candleSeries = chart.addCandlestickSeries({
      upColor: "#22c55e", downColor: "#ef4444",
      borderUpColor: "#16a34a", borderDownColor: "#dc2626",
      wickUpColor: "#22c55e", wickDownColor: "#ef4444",
    });

    // Volume
    const volumeSeries = chart.addHistogramSeries({
      color: "#26a69a", priceFormat: { type: "volume" }, priceScaleId: "vol",
    });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 }, borderVisible: false });

    // EMA lines
    const ema9HighSeries = chart.addLineSeries({
      color: "#3b82f6", lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true, title: "EMA9H",
    });
    const ema9LowSeries = chart.addLineSeries({
      color: "#f97316", lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true, title: "EMA9L",
    });
    const ema9CloseSeries = chart.addLineSeries({
      color: "#a855f7", lineWidth: 1, lineStyle: LineStyle.Dashed,
      priceLineVisible: false, lastValueVisible: true, title: "EMA9C",
    });

    seriesRef.current = { candleSeries, volumeSeries, ema9HighSeries, ema9LowSeries, ema9CloseSeries };

    chart.subscribeCrosshairMove(param => onCrosshairMove && onCrosshairMove(param));

    const ro = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth, height: containerRef.current.clientHeight });
      }
    });
    ro.observe(containerRef.current);

    return () => { ro.disconnect(); chart.remove(); };
  }, []); // eslint-disable-line

  useEffect(() => { seriesRef.current.ema9HighSeries?.applyOptions({ visible: showEMA9High }); }, [showEMA9High]);
  useEffect(() => { seriesRef.current.ema9LowSeries?.applyOptions({ visible: showEMA9Low }); }, [showEMA9Low]);
  useEffect(() => { seriesRef.current.ema9CloseSeries?.applyOptions({ visible: showEMA9Close }); }, [showEMA9Close]);

  useEffect(() => {
    if (!data?.candles?.length || !seriesRef.current.candleSeries) return;
    const { candles, signals } = data;

    const candleData = candles.map(c => ({ time: c.ts, open: c.open, high: c.high, low: c.low, close: c.close }));
    const volumeData = candles.map(c => ({
      time: c.ts, value: c.volume || 0,
      color: c.close >= c.open ? "rgba(34,197,94,0.35)" : "rgba(239,68,68,0.35)",
    }));
    const ema9HData = candles.filter(c => c.ema9High != null).map(c => ({ time: c.ts, value: c.ema9High }));
    const ema9LData = candles.filter(c => c.ema9Low != null).map(c => ({ time: c.ts, value: c.ema9Low }));
    const ema9CData = candles.filter(c => c.ema9Close != null).map(c => ({ time: c.ts, value: c.ema9Close }));

    candleTimesRef.current = candleData.map(c => c.time).sort((a, b) => a - b);

    seriesRef.current.candleSeries.setData(candleData);
    seriesRef.current.volumeSeries.setData(volumeData);
    seriesRef.current.ema9HighSeries.setData(ema9HData);
    seriesRef.current.ema9LowSeries.setData(ema9LData);
    seriesRef.current.ema9CloseSeries.setData(ema9CData);

    const markers = buildMarkers(signals || [], candleTimesRef.current, todayMode);
    seriesRef.current.candleSeries.setMarkers(markers);

    chartRef.current?.timeScale().fitContent();
  }, [data, todayMode]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}

function snapToCandle(ts, sortedTimes) {
  if (!sortedTimes || sortedTimes.length === 0) return ts;
  let lo = 0, hi = sortedTimes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedTimes[mid] < ts) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(sortedTimes[lo - 1] - ts) <= Math.abs(sortedTimes[lo] - ts)) {
    return sortedTimes[lo - 1];
  }
  return sortedTimes[lo];
}

function buildMarkers(signals, sortedCandleTimes, todayMode = false) {
  if (!signals || signals.length === 0) return [];

  const sorted = [...signals].sort((a, b) => a.ts - b.ts);
  const uniqueDays = new Set(sorted.map(s => tsToISTDate(s.ts)));
  const isMultiDay = uniqueDays.size > 1;

  // Multi-day range (not todayMode): only NH/NL, continuous numbering
  const VISIBLE_TYPES_MULTIDAY = new Set(["NEW_HIGH", "NEW_LOW"]);

  const dedupMap = new Map();

  for (const sig of sorted) {
    const style = SIGNAL_STYLES[sig.type];
    if (!style) continue;
    if (isMultiDay && !todayMode && !VISIBLE_TYPES_MULTIDAY.has(sig.type)) continue;

    const snappedTime = snapToCandle(sig.ts, sortedCandleTimes);
    const key = `${sig.type}::${snappedTime}`;

    if (!dedupMap.has(key)) {
      dedupMap.set(key, {
        time: snappedTime,
        position: style.position,
        color: style.color,
        shape: style.shape,
        size: style.size,
        type: sig.type,
        dayStr: tsToISTDate(sig.ts),
      });
    }
  }

  const markerList = Array.from(dedupMap.values()).sort((a, b) => a.time - b.time);

  let globalCounter = 0;
  return markerList.map(m => {
    globalCounter++;
    // todayMode: rolling 1→20 then reset
    const num = todayMode ? ((globalCounter - 1) % 20) + 1 : globalCounter;

    return {
      time: m.time,
      position: m.position,
      color: m.color,
      shape: m.shape,
      text: `${TYPE_LABEL[m.type] || m.type} ${num}`,
      size: m.size,
    };
  });
}