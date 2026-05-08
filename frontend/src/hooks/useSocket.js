// useSocket.js
// ─────────────────────────────────────────────────────────────────────────────
// Real-time data hook with two distinct update paths:
//
// 1. REST (chart_update) — full candle set from backend.
//    Triggered by: initial load, user refresh, TF switch, auto-refresh fallback.
//    Contains: complete OHLC history + EMA overlays + signals.
//
// 2. WebSocket (tick_update) — lightweight live candle patch.
//    Triggered by: every Fyers tick during market hours.
//    Contains: { symbol, resolution, formingCandle } — replaces ONLY the last
//    candle in the current chartData.candles array (or appends if new minute).
//    EMA/signals are NOT recomputed on tick — that happens on chart_update.
//
// Multi-timeframe derivation:
//    The server sends 1m base candles and derives higher TFs via deriveTimeframe().
//    The frontend receives the pre-derived candles for the active resolution.
//    tick_update always carries the forming candle for the active resolution,
//    already aggregated on the backend.
//
// Poll fallback:
//    If no socket update within POLL_INTERVAL_MS, fall back to REST.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback, useRef } from "react";
import { io } from "socket.io-client";
import axios from "axios";

const BACKEND = process.env.REACT_APP_BACKEND_URL || "http://localhost:3299";

// Fallback REST poll if no socket update within this window
const POLL_INTERVAL_MS = 70000; // 1min 10sec

export function useSocket() {
  const [chartData, setChartData] = useState(null);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [tickStreamActive, setTickStreamActive] = useState(false);

  const socketRef = useRef(null);

  // The resolution + symbol the frontend ACTUALLY wants to display.
  // Only refresh() updates these; tick/socket pushes never change them.
  const activeResolutionRef = useRef(null);
  const activeSymbolRef = useRef(null);

  // Timestamp of last received socket update — used for REST polling fallback
  const lastSocketUpdateRef = useRef(0);
  const pollTimerRef = useRef(null);

  // ── REST poll fallback ──────────────────────────────────────────────────
  function startPollFallback() {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    pollTimerRef.current = setInterval(async () => {
      const res = activeResolutionRef.current;
      const sym = activeSymbolRef.current;
      if (!res || !sym) return;

      const age = Date.now() - lastSocketUpdateRef.current;
      if (age < POLL_INTERVAL_MS) return; // socket is delivering — skip

      try {
        const r = await axios.get(`${BACKEND}/api/chart`, {
          params: { symbol: sym, resolution: res },
        });
        const incoming = r.data?.resolution != null ? Number(r.data.resolution) : null;
        if (incoming === activeResolutionRef.current) {
          setChartData(r.data);
          lastSocketUpdateRef.current = Date.now();
        }
      } catch { /* silent */ }
    }, POLL_INTERVAL_MS);
  }

  // ── WebSocket ───────────────────────────────────────────────────────────
  useEffect(() => {
    const socket = io(BACKEND, { transports: ["websocket", "polling"] });
    socketRef.current = socket;

    socket.on("connect", () => { setConnected(true); setError(null); });
    socket.on("disconnect", () => setConnected(false));

    // Full chart update (historical + signals + EMA)
    socket.on("chart_update", (d) => {
      const incoming = d?.resolution != null ? Number(d.resolution) : null;
      const active = activeResolutionRef.current;

      // Guard: drop pushes that don't match active resolution
      if (active !== null && incoming !== null && incoming !== active) return;

      lastSocketUpdateRef.current = Date.now();
      setChartData(d);
      setLoading(false);
      setError(null);
    });

    // ── Candle update (every tick) ─────────────────────────────────────────────
    // Backend sends tick_update AND candle_update on every Fyers tick.
    // The formingCandle contains the live OHLC of the currently-building candle.
    // We update the last candle in-place so the chart moves tick-by-tick.
    function handleCandleUpdate(d) {
      const incoming = d?.resolution != null ? Number(d.resolution) : null;
      const active = activeResolutionRef.current;

      if (active !== null && incoming !== null && incoming !== active) return;
      if (!d?.formingCandle) return;
      if (d?.symbol && activeSymbolRef.current && d.symbol !== activeSymbolRef.current) return;

      lastSocketUpdateRef.current = Date.now();

      setChartData((prev) => {
        if (!prev || !prev.candles || prev.candles.length === 0) return prev;

        const forming = d.formingCandle;
        const prevCandles = prev.candles;
        const lastCandle = prevCandles[prevCandles.length - 1];

        // Floor to minute for comparison (candle.time is ms)
        const formingMin = Math.floor(forming.time / 60000);
        const lastMin = Math.floor(lastCandle.time / 60000);

        let updatedCandles;
        if (formingMin === lastMin) {
          // Same minute — update the last candle in place (tick-by-tick movement)
          updatedCandles = [
            ...prevCandles.slice(0, -1),
            { ...lastCandle, ...forming },
          ];
        } else if (formingMin > lastMin) {
          // New minute — the forming candle is a new bar being built
          updatedCandles = [...prevCandles, forming];
        } else {
          // Stale tick — ignore
          return prev;
        }

        return {
          ...prev,
          candles: updatedCandles,
          lastUpdate: new Date(d.timestamp || Date.now()).toISOString(),
        };
      });
    }

    // Both event names do the same thing — backend sends both for compatibility
    socket.on("tick_update", handleCandleUpdate);
    socket.on("candle_update", handleCandleUpdate);

    // ── New candle (minute boundary) ────────────────────────────────────────────
    // Sent once when a 1m candle is finalized. Appends the closed candle.
    // A chart_update with signals follows shortly after (via setImmediate on backend).
    socket.on("new_candle", (d) => {
      const incoming = d?.resolution != null ? Number(d.resolution) : null;
      const active = activeResolutionRef.current;

      if (active !== null && incoming !== null && incoming !== active) return;
      if (!d?.candle) return;
      if (d?.symbol && activeSymbolRef.current && d.symbol !== activeSymbolRef.current) return;

      lastSocketUpdateRef.current = Date.now();

      setChartData((prev) => {
        if (!prev || !prev.candles || prev.candles.length === 0) return prev;

        const newCandle = d.candle;
        const prevCandles = prev.candles;
        const lastCandle = prevCandles[prevCandles.length - 1];

        const newMin = Math.floor(newCandle.time / 60000);
        const lastMin = Math.floor(lastCandle.time / 60000);

        let updatedCandles;
        if (newMin === lastMin) {
          // Finalize the last candle (it was forming, now closed)
          updatedCandles = [...prevCandles.slice(0, -1), { ...lastCandle, ...newCandle }];
        } else if (newMin > lastMin) {
          updatedCandles = [...prevCandles, newCandle];
        } else {
          return prev;
        }

        return {
          ...prev,
          candles: updatedCandles,
          lastUpdate: new Date(d.timestamp || Date.now()).toISOString(),
        };
      });
    });

    // Market/tick stream status
    socket.on("market_status", (d) => {
      if (d?.tickStreamActive != null) setTickStreamActive(!!d.tickStreamActive);
    });

    socket.on("error", (e) => { setError(e.message); setLoading(false); });

    startPollFallback();

    return () => {
      socket.disconnect();
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []); // eslint-disable-line

  // ── Initial REST fetch ──────────────────────────────────────────────────
  useEffect(() => {
    setLoading(true);
    axios
      .get(`${BACKEND}/api/chart`)
      .then((r) => {
        if (r.data?.resolution != null) {
          activeResolutionRef.current = Number(r.data.resolution);
        }
        if (r.data?.symbol) activeSymbolRef.current = r.data.symbol;
        setChartData(r.data);
        setLoading(false);
        lastSocketUpdateRef.current = Date.now();
      })
      .catch(() => {
        setError(null);
        setLoading(false);
      });
  }, []); // eslint-disable-line

  // ── Refresh (user-triggered or initial) ────────────────────────────────
  const refresh = useCallback(async (symbol, resolution) => {
    setError(null);
    setLoading(true);
    try {
      const params = {};
      if (symbol) params.symbol = symbol;
      if (resolution != null) {
        params.resolution = resolution;
        const numRes = Number(resolution);
        activeResolutionRef.current = numRes;
        activeSymbolRef.current = symbol;

        if (socketRef.current?.connected) {
          socketRef.current.emit("set_resolution", numRes);
        }
      }

      const res = await axios.post(`${BACKEND}/api/chart/refresh`, null, { params });

      if (resolution == null && res.data?.resolution != null) {
        activeResolutionRef.current = Number(res.data.resolution);
      }
      if (res.data?.symbol) activeSymbolRef.current = res.data.symbol;

      setChartData(res.data);
      setLoading(false);
      lastSocketUpdateRef.current = Date.now();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
      setLoading(false);
    }
  }, []);

  return { chartData, connected, loading, error, refresh, tickStreamActive };
}