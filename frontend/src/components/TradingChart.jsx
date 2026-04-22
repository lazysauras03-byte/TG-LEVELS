// TradingChart.jsx
import { useEffect, useRef } from "react";
import { createChart, CrosshairMode, LineStyle } from "lightweight-charts";

const SIGNAL_STYLES = {
  FIRST_HIGH: { color: "#f59e0b", shape: "circle", position: "aboveBar", text: "FH", size: 2 },
  FIRST_LOW: { color: "#f59e0b", shape: "circle", position: "belowBar", text: "FL", size: 2 },
  NEW_HIGH: { color: "#22c55e", shape: "circle", position: "aboveBar", text: "NH", size: 1.5 },
  NEW_LOW: { color: "#ef4444", shape: "circle", position: "belowBar", text: "NL", size: 1.5 },
  LAST_HIGH: { color: "#f59e0b", shape: "circle", position: "aboveBar", text: "LH", size: 2 },
  LAST_LOW: { color: "#f59e0b", shape: "circle", position: "belowBar", text: "LL", size: 2 },
};

// IST offset in seconds (UTC+5:30 = 19800s)
const IST_OFFSET = 19800;

export default function TradingChart({ data, showEMA9High, showEMA9Low, showEMA9Close, onCrosshairMove }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef({});
  // Sorted list of candle timestamps so markers can snap to nearest valid candle
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
        // FIX: tickMarkFormatter and localization.timeFormatter must both use IST offset
        // Fyers returns raw UTC unix timestamps; we shift by +19800s to display IST
        tickMarkFormatter: (time) => {
          const d = new Date((time + IST_OFFSET) * 1000);
          const h = String(d.getUTCHours()).padStart(2, "0");
          const m = String(d.getUTCMinutes()).padStart(2, "0");
          return `${h}:${m}`;
        },
      },
      // FIX: crosshair tooltip time must also show IST — without this,
      // the bottom axis shows IST but the hover tooltip shows UTC, causing mismatch
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

  // EMA toggle
  useEffect(() => { seriesRef.current.ema9HighSeries?.applyOptions({ visible: showEMA9High }); }, [showEMA9High]);
  useEffect(() => { seriesRef.current.ema9LowSeries?.applyOptions({ visible: showEMA9Low }); }, [showEMA9Low]);
  useEffect(() => { seriesRef.current.ema9CloseSeries?.applyOptions({ visible: showEMA9Close }); }, [showEMA9Close]);

  // Data update
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

    // FIX: store sorted candle timestamps so markers snap exactly to a candle
    // lightweight-charts silently drops markers whose time doesn't match any candle
    candleTimesRef.current = candleData.map(c => c.time).sort((a, b) => a - b);

    seriesRef.current.candleSeries.setData(candleData);
    seriesRef.current.volumeSeries.setData(volumeData);
    seriesRef.current.ema9HighSeries.setData(ema9HData);
    seriesRef.current.ema9LowSeries.setData(ema9LData);
    seriesRef.current.ema9CloseSeries.setData(ema9CData);

    // Build markers with snapping to ensure every bubble lands on a valid candle
    const markers = buildMarkers(signals || [], candleTimesRef.current);
    seriesRef.current.candleSeries.setMarkers(markers);

    chartRef.current?.timeScale().fitContent();
  }, [data]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}

/**
 * Binary search: snap unix timestamp to the nearest candle timestamp.
 * Prevents markers from being silently discarded by lightweight-charts
 * when sig.ts doesn't exactly match a candle time (e.g. after resampling).
 */
function snapToCandle(ts, sortedTimes) {
  if (!sortedTimes || sortedTimes.length === 0) return ts;
  let lo = 0, hi = sortedTimes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedTimes[mid] < ts) lo = mid + 1;
    else hi = mid;
  }
  // lo = first index >= ts; compare with lo-1
  if (lo > 0 && Math.abs(sortedTimes[lo - 1] - ts) <= Math.abs(sortedTimes[lo] - ts)) {
    return sortedTimes[lo - 1];
  }
  return sortedTimes[lo];
}

function buildMarkers(signals, sortedCandleTimes) {
  if (!signals || signals.length === 0) return [];

  const deduped = new Map();
  for (const sig of signals) {
    const style = SIGNAL_STYLES[sig.type];
    if (!style) continue;

    // Snap signal ts to nearest actual candle time in the loaded series
    const snappedTime = snapToCandle(sig.ts, sortedCandleTimes);

    // For multi-day range: LAST_* and FIRST_* are keyed by type+time
    // so each day gets its own FH/FL/LH/LL bubble
    const key = `${sig.type}::${snappedTime}`;

    deduped.set(key, {
      time: snappedTime,
      position: style.position,
      color: style.color,
      shape: style.shape,
      text: style.text,
      size: style.size,
    });
  }
  return Array.from(deduped.values()).sort((a, b) => a.time - b.time);
}