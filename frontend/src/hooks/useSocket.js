// useSocket.js — bulletproof edition
// ─────────────────────────────────────────────────────────────────
// ARCHITECTURE:
//   REST  → "/api/chart" (relative) → CRA proxy → localhost:3299
//   WS    → direct to hostname:3299 (bypasses unreliable CRA WS proxy)
//
// STARTUP:
//   1. GET /api/chart immediately on mount (no blocking).
//   2. If { initializing:true } → wait for socket "chart_update".
//   3. If candles returned      → render immediately.
//   4. Socket "chart_update"    → always update chart.
//   5. tick_update / new_candle → live market real-time updates.
//   6. REST poll every 70s      → fallback if socket goes stale.
//
// ERRORS: never show "Network Error" for socket failures alone —
//   only show when REST also fails. Socket reconnects automatically.
// ─────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback, useRef } from "react";
import { io } from "socket.io-client";
import axios from "axios";

// REST: relative → goes through CRA dev-server proxy to port 3299
const BACKEND_REST = process.env.REACT_APP_BACKEND_URL || "";

// Socket: direct connection to port 3299 on the same host.
// This is necessary because CRA's WebSocket proxy is unreliable for Socket.IO
// (breaks on LAN IP access, breaks on reconnects, breaks on polling fallback).
function getSocketURL() {
  if (process.env.REACT_APP_BACKEND_URL) return process.env.REACT_APP_BACKEND_URL;
  // Use same hostname as the browser, but port 3299
  return `${window.location.protocol}//${window.location.hostname}:3299`;
}

const SOCKET_URL = getSocketURL();
const AXIOS_TIMEOUT = 30_000;
const POLL_MS = 70_000;

// ── IST market hours check ────────────────────────────────────────────────────
function isLiveMarket() {
  const now = new Date();
  const ist = 5 * 60 + 30; // IST = UTC+5:30
  const utcMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  const istMin = (utcMin + ist) % (24 * 60);
  const day = new Date(now.getTime() + ist * 60000).getUTCDay();
  if (day === 0 || day === 6) return false;
  return istMin >= 9 * 60 + 15 && istMin < 15 * 60 + 30;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export function useSocket() {
  const [chartData, setChartData] = useState(null);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tickStreamActive, setTickStreamActive] = useState(false);

  const socketRef = useRef(null);
  const resolutionRef = useRef(null);
  const symbolRef = useRef(null);
  const reqIdRef = useRef(0);
  const lastSocketMs = useRef(0);
  const hasData = useRef(false);
  const pollTimer = useRef(null);
  const mountDone = useRef(false);
  const initializingMode = useRef(false); // waiting for server push

  // ── Drop stale socket events ──────────────────────────────────────────────
  const matchesActive = useCallback((d) => {
    if (resolutionRef.current != null && d?.resolution != null &&
      Number(d.resolution) !== resolutionRef.current) return false;
    if (symbolRef.current && d?.symbol && d.symbol !== symbolRef.current) return false;
    return true;
  }, []);

  // ── Apply chart payload (REST or socket) ───────────────────────────────────
  const applyData = useCallback((d) => {
    if (d.resolution != null) resolutionRef.current = Number(d.resolution);
    if (d.symbol) symbolRef.current = d.symbol;
    lastSocketMs.current = Date.now();
    initializingMode.current = false;
    hasData.current = true;
    setChartData(d);
    setLoading(false);
    setError(null);
  }, []);

  // ── GET /api/chart ─────────────────────────────────────────────────────────
  const fetchChart = useCallback(async (sym, res, signal) => {
    const symbol = sym ?? symbolRef.current;
    const resolution = res ?? resolutionRef.current;
    const reqId = ++reqIdRef.current;

    const params = {};
    if (symbol) params.symbol = symbol;
    if (resolution) params.resolution = resolution;

    try {
      const r = await axios.get(`${BACKEND_REST}/api/chart`, {
        params,
        timeout: AXIOS_TIMEOUT,
        signal,
      });
      if (reqId !== reqIdRef.current) return;

      if (r.data?.initializing) {
        // Backend still seeding — stay loading, wait for socket push
        console.log("[socket] backend initializing — waiting for chart_update");
        initializingMode.current = true;
        mountDone.current = true;
        // loading stays true
        return;
      }

      if (!r.data?.candles?.length) {
        // Unexpected empty — wait for socket push, don't error
        initializingMode.current = true;
        mountDone.current = true;
        if (!hasData.current) setLoading(false);
        return;
      }

      applyData(r.data);
      mountDone.current = true;

    } catch (err) {
      if (reqId !== reqIdRef.current) return;
      if (axios.isCancel(err)) return;
      const msg = err.response?.data?.error || err.message || "Network error";
      console.error("[socket] fetchChart error:", msg);
      if (!hasData.current) setError(msg);
      setLoading(false);
      mountDone.current = true;
    }
  }, [applyData]);

  // ── Candle update helper (tick_update / candle_update / new_candle) ────────
  function mergeCandle(prev, nc, tsMs) {
    if (!prev?.candles?.length) return prev;
    const candles = prev.candles;
    const last = candles[candles.length - 1];
    const toMs = t => t > 1e10 ? t : t * 1000;
    const ncMs = toMs(nc.time);
    const lastMs = toMs(last.time);
    const ncMin = Math.floor(ncMs / 60000);
    const lastMin = Math.floor(lastMs / 60000);
    let updated;
    if (ncMin === lastMin) updated = [...candles.slice(0, -1), { ...last, ...nc, time: last.time }];
    else if (ncMin > lastMin) updated = [...candles, { ...nc, time: last.time > 1e10 ? ncMs : Math.floor(ncMs / 1000) }];
    else return prev;
    return { ...prev, candles: updated, lastUpdate: new Date(tsMs || Date.now()).toISOString() };
  }

  // ── WebSocket ──────────────────────────────────────────────────────────────
  useEffect(() => {
    console.log("[socket] connecting to", SOCKET_URL);

    const socket = io(SOCKET_URL, {
      transports: ["websocket", "polling"],
      reconnectionAttempts: 25,
      reconnectionDelay: 1500,
      timeout: 10000,
      forceNew: true,
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      console.log("[socket] connected ✓", socket.id);
      setConnected(true);
      setError(null);
      // On reconnect: if we don't have data yet, try REST again
      if (mountDone.current && !hasData.current) {
        fetchChart(symbolRef.current, resolutionRef.current, undefined);
      }
    });

    socket.on("connect_error", err => {
      console.warn("[socket] connect_error:", err.message);
      // Don't setError here — REST might still work fine via proxy
    });

    socket.on("disconnect", reason => {
      console.log("[socket] disconnected:", reason);
      setConnected(false);
    });

    // Full dataset push
    socket.on("chart_update", d => {
      if (!matchesActive(d)) return;
      lastSocketMs.current = Date.now();
      applyData(d);
    });

    // Forming candle (live tick stream)
    const onCandleUpdate = d => {
      if (!matchesActive(d) || !d?.formingCandle) return;
      lastSocketMs.current = Date.now();
      setChartData(prev => mergeCandle(prev, d.formingCandle, d.timestamp));
    };
    socket.on("tick_update", onCandleUpdate);
    socket.on("candle_update", onCandleUpdate);

    // Finalized candle
    socket.on("new_candle", d => {
      if (!matchesActive(d) || !d?.candle) return;
      lastSocketMs.current = Date.now();
      setChartData(prev => mergeCandle(prev, d.candle, d.timestamp));
    });

    socket.on("market_status", d => {
      if (d?.tickStreamActive != null) setTickStreamActive(!!d.tickStreamActive);
    });

    socket.on("error", e => {
      console.error("[socket] server error:", e);
      // Only propagate to UI if we have no data
      if (!hasData.current) {
        setError(e?.message || String(e));
        setLoading(false);
      }
    });

    // REST poll fallback — runs only during live market hours
    // and only if socket hasn't sent data recently
    pollTimer.current = setInterval(async () => {
      if (!isLiveMarket()) return;
      if (!symbolRef.current || !resolutionRef.current) return;
      if (Date.now() - lastSocketMs.current < POLL_MS) return;
      console.log("[socket] poll fallback firing");
      await fetchChart(symbolRef.current, resolutionRef.current, undefined);
    }, POLL_MS);

    return () => {
      socket.disconnect();
      clearInterval(pollTimer.current);
    };
  }, []); // eslint-disable-line

  // ── Initial fetch on mount ─────────────────────────────────────────────────
  useEffect(() => {
    setLoading(true);
    const ctrl = new AbortController();
    fetchChart(null, null, ctrl.signal);
    return () => ctrl.abort();
  }, []); // eslint-disable-line

  // ── refresh() — called by Refresh button / symbol change / tf change ───────
  const refresh = useCallback(async (symbol, resolution) => {
    setError(null);
    if (!hasData.current) setLoading(true);
    const reqId = ++reqIdRef.current;

    if (symbol != null) symbolRef.current = symbol;
    if (resolution != null) {
      resolutionRef.current = Number(resolution);
      socketRef.current?.connected &&
        socketRef.current.emit("set_resolution", Number(resolution));
    }

    const params = {};
    if (symbol != null) params.symbol = symbol;
    if (resolution != null) params.resolution = resolution;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await axios.post(`${BACKEND_REST}/api/chart/refresh`, null, {
          params, timeout: AXIOS_TIMEOUT,
        });
        if (reqId !== reqIdRef.current) return;

        if (!r.data?.candles?.length) {
          if (attempt < 2) { await sleep(2000); continue; }
          setLoading(false); return;
        }

        if (r.data.resolution != null) resolutionRef.current = Number(r.data.resolution);
        if (r.data.symbol) symbolRef.current = r.data.symbol;
        applyData(r.data);
        return;

      } catch (e) {
        if (reqId !== reqIdRef.current) return;
        if (attempt < 2) { await sleep(2000); continue; }

        // Final attempt: try GET as fallback (stale cache)
        try {
          const fb = await axios.get(`${BACKEND_REST}/api/chart`, {
            params, timeout: AXIOS_TIMEOUT,
          });
          if (reqId !== reqIdRef.current) return;
          if (fb.data?.candles?.length) { applyData(fb.data); return; }
        } catch { /* ignore */ }

        setError(e.response?.data?.error || e.message || "Refresh failed");
        setLoading(false);
      }
    }
  }, [applyData]); // eslint-disable-line

  return { chartData, connected, loading, error, refresh, tickStreamActive };
}