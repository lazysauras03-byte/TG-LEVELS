// useSocket.js
// ─────────────────────────────────────────────────────────────────────────────
// FIXES applied in this version:
//
// 1. REQUEST-ID ANTI-RACE PATTERN
//    Every refresh() call gets a unique numeric requestId.
//    The response is only accepted if its requestId matches the LATEST one.
//    Old/slow responses (e.g. previous symbol fetch) are silently discarded.
//    This eliminates the "wrong symbol Y-axis" bug (Image 2 in bug report).
//
// 2. MARKET-CLOSED POLL GUARD
//    The REST fallback poll now also checks isMarketOpen on the frontend
//    using a simple IST time window (09:15–15:31). No fetches after close.
//
// 3. SYMBOL GUARD on socket events
//    tick_update / candle_update / new_candle are all dropped when
//    d.symbol !== activeSymbolRef.current (already existed, kept intact).
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback, useRef } from "react";
import { io } from "socket.io-client";
import axios from "axios";

const BACKEND = process.env.REACT_APP_BACKEND_URL || "http://localhost:3299";
const POLL_INTERVAL_MS = 70000; // 1min 10sec — fallback only when socket silent

// ── Lightweight IST market-hours check (frontend) ─────────────────────────────
function isMarketOpen() {
  const now = new Date();
  const istOffset = 5 * 60 + 30; // minutes
  const utcMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  const istMin = (utcMin + istOffset) % (24 * 60);
  const dayOfWeek = new Date(now.getTime() + istOffset * 60000).getUTCDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) return false; // Sat/Sun
  const open  = 9  * 60 + 15;
  const close = 15 * 60 + 31;
  return istMin >= open && istMin < close;
}

export function useSocket() {
  const [chartData, setChartData]               = useState(null);
  const [connected, setConnected]               = useState(false);
  const [loading, setLoading]                   = useState(false);
  const [error, setError]                       = useState(null);
  const [tickStreamActive, setTickStreamActive] = useState(false);

  const socketRef = useRef(null);

  const activeResolutionRef  = useRef(null);
  const activeSymbolRef      = useRef(null);

  // ── Request-ID anti-race ──────────────────────────────────────────────────
  const latestRequestIdRef = useRef(0);

  const lastSocketUpdateRef = useRef(0);
  const pollTimerRef        = useRef(null);

  // ── REST poll fallback ────────────────────────────────────────────────────
  function startPollFallback() {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    pollTimerRef.current = setInterval(async () => {
      const res = activeResolutionRef.current;
      const sym = activeSymbolRef.current;
      if (!res || !sym) return;

      // KEY FIX: skip entirely when market is closed
      if (!isMarketOpen()) return;

      const age = Date.now() - lastSocketUpdateRef.current;
      if (age < POLL_INTERVAL_MS) return;

      const reqId = ++latestRequestIdRef.current;
      try {
        const r = await axios.get(`${BACKEND}/api/chart`, {
          params: { symbol: sym, resolution: res },
        });
        if (reqId !== latestRequestIdRef.current) return;
        const incoming = r.data?.resolution != null ? Number(r.data.resolution) : null;
        if (incoming === activeResolutionRef.current && r.data?.symbol === activeSymbolRef.current) {
          setChartData(r.data);
          lastSocketUpdateRef.current = Date.now();
        }
      } catch { /* silent */ }
    }, POLL_INTERVAL_MS);
  }

  // ── WebSocket ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const socket = io(BACKEND, { transports: ["websocket", "polling"] });
    socketRef.current = socket;

    socket.on("connect",    () => { setConnected(true);  setError(null); });
    socket.on("disconnect", () => setConnected(false));

    socket.on("chart_update", (d) => {
      const incoming = d?.resolution != null ? Number(d.resolution) : null;
      const active   = activeResolutionRef.current;

      if (active !== null && incoming !== null && incoming !== active) return;
      if (d?.symbol && activeSymbolRef.current && d.symbol !== activeSymbolRef.current) return;

      lastSocketUpdateRef.current = Date.now();
      setChartData(d);
      setLoading(false);
      setError(null);
    });

    function handleCandleUpdate(d) {
      const incoming = d?.resolution != null ? Number(d.resolution) : null;
      const active   = activeResolutionRef.current;

      if (active !== null && incoming !== null && incoming !== active) return;
      if (!d?.formingCandle) return;
      if (d?.symbol && activeSymbolRef.current && d.symbol !== activeSymbolRef.current) return;

      lastSocketUpdateRef.current = Date.now();

      setChartData((prev) => {
        if (!prev || !prev.candles || prev.candles.length === 0) return prev;

        const forming     = d.formingCandle;
        const prevCandles = prev.candles;
        const lastCandle  = prevCandles[prevCandles.length - 1];

        const formingMin = Math.floor(forming.time / 60000);
        const lastMin    = Math.floor(lastCandle.time / 60000);

        let updatedCandles;
        if (formingMin === lastMin) {
          updatedCandles = [...prevCandles.slice(0, -1), { ...lastCandle, ...forming }];
        } else if (formingMin > lastMin) {
          updatedCandles = [...prevCandles, forming];
        } else {
          return prev;
        }

        return {
          ...prev,
          candles: updatedCandles,
          lastUpdate: new Date(d.timestamp || Date.now()).toISOString(),
        };
      });
    }

    socket.on("tick_update",   handleCandleUpdate);
    socket.on("candle_update", handleCandleUpdate);

    socket.on("new_candle", (d) => {
      const incoming = d?.resolution != null ? Number(d.resolution) : null;
      const active   = activeResolutionRef.current;

      if (active !== null && incoming !== null && incoming !== active) return;
      if (!d?.candle) return;
      if (d?.symbol && activeSymbolRef.current && d.symbol !== activeSymbolRef.current) return;

      lastSocketUpdateRef.current = Date.now();

      setChartData((prev) => {
        if (!prev || !prev.candles || prev.candles.length === 0) return prev;

        const newCandle   = d.candle;
        const prevCandles = prev.candles;
        const lastCandle  = prevCandles[prevCandles.length - 1];

        const newMin  = Math.floor(newCandle.time / 60000);
        const lastMin = Math.floor(lastCandle.time / 60000);

        let updatedCandles;
        if (newMin === lastMin) {
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

  // ── Initial REST fetch ────────────────────────────────────────────────────
  useEffect(() => {
    setLoading(true);
    const reqId = ++latestRequestIdRef.current;
    axios
      .get(`${BACKEND}/api/chart`)
      .then((r) => {
        if (reqId !== latestRequestIdRef.current) return;
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

  // ── Refresh ───────────────────────────────────────────────────────────────
  const refresh = useCallback(async (symbol, resolution) => {
    setError(null);
    setLoading(true);

    // Bump BEFORE the async call — any older in-flight response is now stale
    const reqId = ++latestRequestIdRef.current;

    // Update active refs immediately so socket guards work right away
    if (symbol)              activeSymbolRef.current     = symbol;
    if (resolution != null) {
      const numRes = Number(resolution);
      activeResolutionRef.current = numRes;
      if (socketRef.current?.connected) {
        socketRef.current.emit("set_resolution", numRes);
      }
    }

    try {
      const params = {};
      if (symbol)              params.symbol     = symbol;
      if (resolution != null)  params.resolution = resolution;

      const res = await axios.post(`${BACKEND}/api/chart/refresh`, null, { params });

      // Drop stale response — user has already moved on
      if (reqId !== latestRequestIdRef.current) {
        console.log(`[useSocket] Discarding stale response (req ${reqId} < current ${latestRequestIdRef.current})`);
        return;
      }

      if (resolution == null && res.data?.resolution != null) {
        activeResolutionRef.current = Number(res.data.resolution);
      }
      if (res.data?.symbol) activeSymbolRef.current = res.data.symbol;

      setChartData(res.data);
      setLoading(false);
      lastSocketUpdateRef.current = Date.now();
    } catch (e) {
      if (reqId !== latestRequestIdRef.current) return;
      setError(e.response?.data?.error || e.message);
      setLoading(false);
    }
  }, []);

  return { chartData, connected, loading, error, refresh, tickStreamActive };
}
