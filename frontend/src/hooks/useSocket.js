// useSocket.js
// ─────────────────────────────────────────────────────────────────
// RULES:
//   • Always GET /api/chart — backend handles cache TTL and freshness
//   • POST /api/chart/refresh — only when user explicitly clicks Refresh
//   • Tick stream (WebSocket) is server-managed — frontend just listens
//   • Works on weekends, after hours, any symbol from Excel/JSON
// ─────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback, useRef } from "react";
import { io } from "socket.io-client";
import axios from "axios";
import { BACKEND } from "../config";

export function useSocket() {
  const [chartData, setChartData] = useState(null);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [tickStreamActive, setTickStreamActive] = useState(false);

  const socketRef = useRef(null);
  const activeResolutionRef = useRef(null);
  const activeSymbolRef = useRef(null);
  const latestRequestIdRef = useRef(0);
  const lastSocketUpdateRef = useRef(0);
  const hasDataRef = useRef(false);

  // ── matchesActive — guard against stale socket events ────────────────────
  const matchesActive = useCallback((d) => {
    const incomingRes = d?.resolution != null ? Number(d.resolution) : null;
    const activeRes = activeResolutionRef.current;
    if (activeRes !== null && incomingRes !== null && incomingRes !== activeRes) return false;
    if (d?.symbol && activeSymbolRef.current && d.symbol !== activeSymbolRef.current) return false;
    return true;
  }, []);

  // ── fetchChart — GET /api/chart (works any time, any day, any symbol) ────
  // Retries with backoff if backend returns empty candles (startup race).
  const fetchChart = useCallback(async (symbol, resolution, { retries = 5, signal } = {}) => {
    const sym = symbol ?? activeSymbolRef.current;
    const res = resolution ?? activeResolutionRef.current;
    const reqId = ++latestRequestIdRef.current;

    const params = {};
    if (sym) params.symbol = sym;
    if (res) params.resolution = res;

    for (let attempt = 0; attempt <= retries; attempt++) {
      if (signal?.aborted) return;
      try {
        const r = await axios.get(`${BACKEND}/api/chart`, { params, timeout: 15_000 });
        if (reqId !== latestRequestIdRef.current) return; // stale — another request won

        if (!r.data?.candles?.length) {
          // Backend cache not warm yet (startup race) — wait and retry
          if (attempt < retries) {
            await sleep(1500 * (attempt + 1));
            continue;
          }
          setLoading(false);
          return; // give up — socket will deliver data
        }

        if (r.data.resolution != null) activeResolutionRef.current = Number(r.data.resolution);
        if (r.data.symbol) activeSymbolRef.current = r.data.symbol;

        setChartData(r.data);
        hasDataRef.current = true;
        lastSocketUpdateRef.current = Date.now();
        setLoading(false);
        setError(null);
        return;
      } catch {
        if (reqId !== latestRequestIdRef.current) return;
        if (attempt < retries) {
          await sleep(1500 * (attempt + 1));
          continue;
        }
        setLoading(false);
      }
    }
  }, []); // eslint-disable-line

  // ── WebSocket ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const socket = io(BACKEND, {
      transports: ["websocket", "polling"],
      reconnectionAttempts: 15,
      reconnectionDelay: 2000,
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      setError(null);
      // If we still don't have data, fetch now that we know backend is reachable
      if (!hasDataRef.current) {
        fetchChart(activeSymbolRef.current, activeResolutionRef.current, { retries: 3 });
      }
    });

    socket.on("disconnect", () => setConnected(false));

    // Full chart update from server (after candle finalize or manual refresh)
    socket.on("chart_update", (d) => {
      if (!matchesActive(d)) return;
      lastSocketUpdateRef.current = Date.now();
      setChartData(d);
      hasDataRef.current = true;
      setLoading(false);
      setError(null);
    });

    // Tick-by-tick forming candle update (live market only)
    function handleCandleUpdate(d) {
      if (!matchesActive(d) || !d?.formingCandle) return;
      lastSocketUpdateRef.current = Date.now();
      setChartData((prev) => {
        if (!prev?.candles?.length) return prev;
        const { formingCandle: fc, timestamp } = d;
        const candles = prev.candles;
        const last = candles[candles.length - 1];
        const fcMin = Math.floor(fc.time / 60000);
        const lastMin = Math.floor(last.time / 60000);
        let updated;
        if (fcMin === lastMin) updated = [...candles.slice(0, -1), { ...last, ...fc }];
        else if (fcMin > lastMin) updated = [...candles, fc];
        else return prev;
        return { ...prev, candles: updated, lastUpdate: new Date(timestamp || Date.now()).toISOString() };
      });
    }
    socket.on("tick_update", handleCandleUpdate);
    socket.on("candle_update", handleCandleUpdate);

    // Finalized candle — append to chart
    socket.on("new_candle", (d) => {
      if (!matchesActive(d) || !d?.candle) return;
      lastSocketUpdateRef.current = Date.now();
      setChartData((prev) => {
        if (!prev?.candles?.length) return prev;
        const { candle: nc, timestamp } = d;
        const candles = prev.candles;
        const last = candles[candles.length - 1];
        const ncMin = Math.floor(nc.time / 60000);
        const lastMin = Math.floor(last.time / 60000);
        let updated;
        if (ncMin === lastMin) updated = [...candles.slice(0, -1), { ...last, ...nc }];
        else if (ncMin > lastMin) updated = [...candles, nc];
        else return prev;
        return { ...prev, candles: updated, lastUpdate: new Date(timestamp || Date.now()).toISOString() };
      });
    });

    socket.on("market_status", (d) => {
      if (d?.tickStreamActive != null) setTickStreamActive(!!d.tickStreamActive);
    });

    socket.on("error", (e) => {
      setError(e?.message || String(e));
      setLoading(false);
    });

    return () => { socket.disconnect(); };
  }, []); // eslint-disable-line

  // ── Initial data fetch on mount ───────────────────────────────────────────
  useEffect(() => {
    setLoading(true);
    const abortCtrl = new AbortController();
    fetchChart(null, null, { retries: 5, signal: abortCtrl.signal });
    return () => abortCtrl.abort();
  }, []); // eslint-disable-line

  // ── refresh — called when user clicks Refresh, changes symbol, or TF ─────
  // Always POSTs to /api/chart/refresh to get the absolute freshest data
  // and broadcast to all connected clients.
  const refresh = useCallback(async (symbol, resolution) => {
    setError(null);
    setLoading(true);
    const reqId = ++latestRequestIdRef.current;

    if (symbol != null) activeSymbolRef.current = symbol;
    if (resolution != null) {
      const numRes = Number(resolution);
      activeResolutionRef.current = numRes;
      if (socketRef.current?.connected) socketRef.current.emit("set_resolution", numRes);
    }

    const params = {};
    if (symbol != null) params.symbol = symbol;
    if (resolution != null) params.resolution = resolution;

    const maxAttempts = 3;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        // POST /refresh → backend fetches fresh from Fyers REST (works any day/time)
        // and broadcasts to all socket clients in the room.
        const res = await axios.post(`${BACKEND}/api/chart/refresh`, null, {
          params,
          timeout: 20_000,
        });

        if (reqId !== latestRequestIdRef.current) return; // stale

        if (!res.data?.candles?.length) {
          // Extremely unlikely after a forced refresh, but handle gracefully
          if (attempt < maxAttempts - 1) { await sleep(2000); continue; }
          setLoading(false);
          return;
        }

        if (resolution == null && res.data?.resolution != null)
          activeResolutionRef.current = Number(res.data.resolution);
        if (res.data?.symbol)
          activeSymbolRef.current = res.data.symbol;

        setChartData(res.data);
        hasDataRef.current = true;
        lastSocketUpdateRef.current = Date.now();
        setLoading(false);
        setError(null);
        return;
      } catch (e) {
        if (reqId !== latestRequestIdRef.current) return;
        if (attempt < maxAttempts - 1) { await sleep(2000); continue; }
        setError(e.response?.data?.error || e.message);
        setLoading(false);
      }
    }
  }, []); // eslint-disable-line

  return { chartData, connected, loading, error, refresh, tickStreamActive };
}

// ── Utility ──────────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}