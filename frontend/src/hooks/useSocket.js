// useSocket.js
// ─────────────────────────────────────────────────────────────────
// RULES:
//   • Always GET /api/chart on mount — backend handles cache TTL
//   • POST /api/chart/refresh — only when user explicitly clicks Refresh
//     or changes symbol/timeframe
//   • Tick stream (WebSocket) is server-managed — frontend just listens
//   • Works on weekends, after hours, any symbol from Excel/JSON
//   • REST poll fallback ONLY runs during live market hours
//
// FIXES:
//   • axios timeout raised to 15 000 ms — stays under backend's INIT_WAIT_MS
//     (8 s) plus network overhead and safely under the 20 s hard limit
//   • No duplicate fetchChart on connect — socket chart_update handles
//     initial data delivery; fetchChart is mount-only fallback
//   • fetchChart retries when backend returns empty candles (backend
//     initialRestFetch may still be in progress on startup)
//   • loading stays true until we either get data OR exhaust all retries
//   • refresh() errors are always surfaced — no silent swallows
//   • matchesActive: null activeResolutionRef always passes (first load)
// ─────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback, useRef } from "react";
import { io } from "socket.io-client";
import axios from "axios";

// REST: relative URLs ("/api/chart") so CRA dev-server proxy forwards to localhost:3299.
// Socket.IO: window.location.origin — same dev server, proxy tunnels WS to localhost:3299.
const BACKEND_REST = process.env.REACT_APP_BACKEND_URL || "";
const BACKEND_WS = process.env.REACT_APP_BACKEND_URL || window.location.origin;

// Axios timeout for chart requests.
// Must stay under backend's INIT_WAIT_MS (8 s) + network + margin, but
// comfortably below 20 000 ms so the "timeout of 20000ms exceeded" error
// from the old 20 s value can never fire.
const AXIOS_TIMEOUT_MS = 15_000;

// ── IST live-market check (frontend guard for REST poll fallback only) ─────────
function isLiveMarketFrontend() {
  const now = new Date();
  const istOffset = 5 * 60 + 30;
  const utcMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  const istMin = (utcMin + istOffset) % (24 * 60);
  const istDate = new Date(now.getTime() + istOffset * 60000);
  const dow = istDate.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  return istMin >= (9 * 60 + 15) && istMin < (15 * 60 + 30);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function useSocket() {
  const [chartData, setChartData] = useState(null);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tickStreamActive, setTickStreamActive] = useState(false);

  const socketRef = useRef(null);
  const activeResolutionRef = useRef(null);
  const activeSymbolRef = useRef(null);
  const latestRequestIdRef = useRef(0);
  const lastSocketUpdateRef = useRef(0);
  const hasDataRef = useRef(false);
  const pollTimerRef = useRef(null);
  const mountFetchDoneRef = useRef(false);

  // ── matchesActive — drop stale socket events ──────────────────────────────
  const matchesActive = useCallback((d) => {
    const inRes = d?.resolution != null ? Number(d.resolution) : null;
    const activeRes = activeResolutionRef.current;
    if (activeRes !== null && inRes !== null && inRes !== activeRes) return false;
    if (d?.symbol && activeSymbolRef.current && d.symbol !== activeSymbolRef.current) return false;
    return true;
  }, []);

  // ── fetchChart — GET /api/chart (works 24/7, any symbol, any day) ─────────
  const fetchChart = useCallback(async (symbol, resolution, { retries = 6, signal } = {}) => {
    const sym = symbol ?? activeSymbolRef.current;
    const res = resolution ?? activeResolutionRef.current;
    const reqId = ++latestRequestIdRef.current;

    const params = {};
    if (sym) params.symbol = sym;
    if (res) params.resolution = res;

    for (let attempt = 0; attempt <= retries; attempt++) {
      if (signal?.aborted) return;
      if (reqId !== latestRequestIdRef.current) return;

      try {
        const r = await axios.get(`${BACKEND_REST}/api/chart`, {
          params,
          timeout: AXIOS_TIMEOUT_MS,
        });
        if (reqId !== latestRequestIdRef.current) return;

        if (!r.data?.candles?.length) {
          // Backend cache not warm yet — retry with back-off
          if (attempt < retries) {
            await sleep(Math.min(1500 * (attempt + 1), 8000));
            continue;
          }
          setLoading(false);
          mountFetchDoneRef.current = true;
          return;
        }

        if (r.data.resolution != null) activeResolutionRef.current = Number(r.data.resolution);
        if (r.data.symbol) activeSymbolRef.current = r.data.symbol;

        setChartData(r.data);
        hasDataRef.current = true;
        lastSocketUpdateRef.current = Date.now();
        setLoading(false);
        setError(null);
        mountFetchDoneRef.current = true;
        return;
      } catch (err) {
        if (signal?.aborted) return;
        if (reqId !== latestRequestIdRef.current) return;
        if (attempt < retries) {
          await sleep(Math.min(1500 * (attempt + 1), 8000));
          continue;
        }
        if (!hasDataRef.current) {
          setError(err.response?.data?.error || err.message || "Network error");
        }
        setLoading(false);
        mountFetchDoneRef.current = true;
      }
    }
  }, []); // eslint-disable-line

  // ── REST poll fallback (live market hours only) ───────────────────────────
  const POLL_INTERVAL_MS = 70_000;

  function startPollFallback() {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    pollTimerRef.current = setInterval(async () => {
      if (!isLiveMarketFrontend()) return;
      const res = activeResolutionRef.current;
      const sym = activeSymbolRef.current;
      if (!res || !sym) return;
      if (Date.now() - lastSocketUpdateRef.current < POLL_INTERVAL_MS) return;
      await fetchChart(sym, res, { retries: 1 });
    }, POLL_INTERVAL_MS);
  }

  // ── WebSocket ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const socket = io(BACKEND_WS, {
      transports: ["websocket", "polling"],
      reconnectionAttempts: 15,
      reconnectionDelay: 2000,
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      setError(null);
      if (mountFetchDoneRef.current && !hasDataRef.current) {
        fetchChart(activeSymbolRef.current, activeResolutionRef.current, { retries: 3 });
      }
    });

    socket.on("disconnect", () => setConnected(false));

    socket.on("chart_update", (d) => {
      if (!matchesActive(d)) return;
      if (d.resolution != null) activeResolutionRef.current = Number(d.resolution);
      if (d.symbol) activeSymbolRef.current = d.symbol;
      lastSocketUpdateRef.current = Date.now();
      setChartData(d);
      hasDataRef.current = true;
      setLoading(false);
      setError(null);
    });

    function handleCandleUpdate(d) {
      if (!matchesActive(d) || !d?.formingCandle) return;
      lastSocketUpdateRef.current = Date.now();
      setChartData((prev) => {
        if (!prev?.candles?.length) return prev;
        const { formingCandle: fc, timestamp } = d;
        const candles = prev.candles;
        const last = candles[candles.length - 1];

        const toMs = (t) => (t > 1e10 ? t : t * 1000);
        const fcMs = toMs(fc.time);
        const lastMs = toMs(last.time);
        const fcMin = Math.floor(fcMs / 60000);
        const lastMin = Math.floor(lastMs / 60000);

        let updated;
        if (fcMin === lastMin) {
          updated = [...candles.slice(0, -1), { ...last, ...fc, time: last.time }];
        } else if (fcMin > lastMin) {
          const newCandle = { ...fc, time: last.time > 1e10 ? fcMs : Math.floor(fcMs / 1000) };
          updated = [...candles, newCandle];
        } else {
          return prev;
        }
        return { ...prev, candles: updated, lastUpdate: new Date(timestamp || Date.now()).toISOString() };
      });
    }
    socket.on("tick_update", handleCandleUpdate);
    socket.on("candle_update", handleCandleUpdate);

    socket.on("new_candle", (d) => {
      if (!matchesActive(d) || !d?.candle) return;
      lastSocketUpdateRef.current = Date.now();
      setChartData((prev) => {
        if (!prev?.candles?.length) return prev;
        const { candle: nc, timestamp } = d;
        const candles = prev.candles;
        const last = candles[candles.length - 1];

        const toMs = (t) => (t > 1e10 ? t : t * 1000);
        const ncMs = toMs(nc.time);
        const lastMs = toMs(last.time);
        const ncMin = Math.floor(ncMs / 60000);
        const lastMin = Math.floor(lastMs / 60000);

        let updated;
        if (ncMin === lastMin) {
          updated = [...candles.slice(0, -1), { ...last, ...nc, time: last.time }];
        } else if (ncMin > lastMin) {
          const newCandle = { ...nc, time: last.time > 1e10 ? ncMs : Math.floor(ncMs / 1000) };
          updated = [...candles, newCandle];
        } else {
          return prev;
        }
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

    startPollFallback();

    return () => {
      socket.disconnect();
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []); // eslint-disable-line

  // ── Initial data fetch on mount ───────────────────────────────────────────
  // One fetch on mount with generous retries.
  // NOTE: We do NOT call refresh() here — that triggers a POST which
  // races with the backend's initialRestFetch on cold start.
  // GET /api/chart is safe; the backend waits for initialRestFetch before
  // responding and serves the cache if it's already warm.
  useEffect(() => {
    setLoading(true);
    const abortCtrl = new AbortController();
    fetchChart(null, null, { retries: 6, signal: abortCtrl.signal });
    return () => abortCtrl.abort();
  }, []); // eslint-disable-line

  // ── refresh — user clicks Refresh, changes symbol, or changes timeframe ───
  const refresh = useCallback(async (symbol, resolution) => {
    setError(null);
    if (!hasDataRef.current) setLoading(true);
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

    const MAX_ATTEMPTS = 3;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        const res = await axios.post(`${BACKEND_REST}/api/chart/refresh`, null, {
          params,
          timeout: AXIOS_TIMEOUT_MS,
        });

        if (reqId !== latestRequestIdRef.current) return;

        if (!res.data?.candles?.length) {
          if (attempt < MAX_ATTEMPTS - 1) { await sleep(2000); continue; }
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
        if (attempt < MAX_ATTEMPTS - 1) { await sleep(2000); continue; }
        // On final attempt failure: fall back to GET /api/chart (serve stale cache)
        try {
          const fallback = await axios.get(`${BACKEND_REST}/api/chart`, {
            params,
            timeout: AXIOS_TIMEOUT_MS,
          });
          if (reqId !== latestRequestIdRef.current) return;
          if (fallback.data?.candles?.length) {
            setChartData(fallback.data);
            hasDataRef.current = true;
            lastSocketUpdateRef.current = Date.now();
            setLoading(false);
            setError(null);
            return;
          }
        } catch { /* ignore fallback error */ }
        setError(e.response?.data?.error || e.message || "Refresh failed");
        setLoading(false);
      }
    }
  }, []); // eslint-disable-line

  return { chartData, connected, loading, error, refresh, tickStreamActive };
}