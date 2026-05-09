// useSocket.js — all fixes applied:
//  1. Auto-detects backend URL (LAN + localhost both work — no hardcoded IP)
//  2. Weekend/after-hours: refresh() uses GET (cached) not POST (hits Fyers)
//  3. Request-ID anti-race: stale responses from old requests are discarded
//  4. Symbol + resolution guards on all socket events (no data crossover)
//  5. Initial fetch errors are silent — socket delivers data when connected

import { useState, useEffect, useCallback, useRef } from "react";
import { io } from "socket.io-client";
import axios from "axios";
import { BACKEND } from "../config";

const POLL_INTERVAL_MS = 70000; // 1 min 10s — REST fallback only when socket silent

// ── IST market-hours check ────────────────────────────────────────────────────
function isMarketOpen() {
  const now = new Date();
  const istOffset = 5 * 60 + 30;
  const utcMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  const istMin = (utcMin + istOffset) % (24 * 60);
  const dow = new Date(now.getTime() + istOffset * 60000).getUTCDay();
  if (dow === 0 || dow === 6) return false;
  return istMin >= 9 * 60 + 15 && istMin < 15 * 60 + 31;
}

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
  const pollTimerRef = useRef(null);

  // ── REST poll fallback (market hours only) ────────────────────────────────
  function startPollFallback() {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    pollTimerRef.current = setInterval(async () => {
      const res = activeResolutionRef.current;
      const sym = activeSymbolRef.current;
      if (!res || !sym || !isMarketOpen()) return;
      if (Date.now() - lastSocketUpdateRef.current < POLL_INTERVAL_MS) return;
      const reqId = ++latestRequestIdRef.current;
      try {
        const r = await axios.get(`${BACKEND}/api/chart`, { params: { symbol: sym, resolution: res } });
        if (reqId !== latestRequestIdRef.current) return;
        if (Number(r.data?.resolution) === activeResolutionRef.current &&
          r.data?.symbol === activeSymbolRef.current) {
          setChartData(r.data);
          lastSocketUpdateRef.current = Date.now();
        }
      } catch { /* silent */ }
    }, POLL_INTERVAL_MS);
  }

  // ── WebSocket ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const socket = io(BACKEND, {
      transports: ["websocket", "polling"],
      reconnectionAttempts: 15,
      reconnectionDelay: 2000,
    });
    socketRef.current = socket;

    socket.on("connect", () => { setConnected(true); setError(null); });
    socket.on("disconnect", () => setConnected(false));

    // Full chart replace
    socket.on("chart_update", (d) => {
      if (!matchesActive(d)) return;
      lastSocketUpdateRef.current = Date.now();
      setChartData(d);
      setLoading(false);
      setError(null);
    });

    // Live tick — update forming candle
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

    // Finalized candle — append
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

    // Socket-level errors — show but don't crash
    socket.on("error", (e) => { setError(e?.message || String(e)); setLoading(false); });

    startPollFallback();
    return () => {
      socket.disconnect();
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };

    // ── helpers ─────────────────────────────────────────────────────────────
    function matchesActive(d) {
      const incomingRes = d?.resolution != null ? Number(d.resolution) : null;
      const activeRes = activeResolutionRef.current;
      if (activeRes !== null && incomingRes !== null && incomingRes !== activeRes) return false;
      if (d?.symbol && activeSymbolRef.current && d.symbol !== activeSymbolRef.current) return false;
      return true;
    }
  }, []); // eslint-disable-line

  // ── Initial REST fetch on mount ───────────────────────────────────────────
  useEffect(() => {
    setLoading(true);
    const reqId = ++latestRequestIdRef.current;
    axios.get(`${BACKEND}/api/chart`)
      .then((r) => {
        if (reqId !== latestRequestIdRef.current) return;
        if (r.data?.resolution != null) activeResolutionRef.current = Number(r.data.resolution);
        if (r.data?.symbol) activeSymbolRef.current = r.data.symbol;
        setChartData(r.data);
        setLoading(false);
        lastSocketUpdateRef.current = Date.now();
      })
      .catch(() => setLoading(false)); // silent — socket will deliver data
  }, []); // eslint-disable-line

  // ── Refresh ───────────────────────────────────────────────────────────────
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

    try {
      // Market open  → POST /refresh (forces fresh Fyers fetch, broadcasts to all clients)
      // Market closed → GET /chart   (serves cache, no Fyers call, no errors on weekends)
      const res = isMarketOpen()
        ? await axios.post(`${BACKEND}/api/chart/refresh`, null, { params })
        : await axios.get(`${BACKEND}/api/chart`, { params });

      if (reqId !== latestRequestIdRef.current) return; // stale — discard

      if (resolution == null && res.data?.resolution != null)
        activeResolutionRef.current = Number(res.data.resolution);
      if (res.data?.symbol)
        activeSymbolRef.current = res.data.symbol;

      setChartData(res.data);
      setLoading(false);
      lastSocketUpdateRef.current = Date.now();
    } catch (e) {
      if (reqId !== latestRequestIdRef.current) return;
      setError(e.response?.data?.error || e.message);
      setLoading(false);
    }
  }, []); // eslint-disable-line

  return { chartData, connected, loading, error, refresh, tickStreamActive };
}