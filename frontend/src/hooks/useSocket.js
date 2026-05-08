// useSocket.js — fixed:
//  1. Tells the server which resolution is active via "set_resolution" events
//     so the server only broadcasts auto-refreshes for that resolution.
//  2. Frontend still guards incoming socket pushes by resolution (belt+suspenders).
//  3. refresh() is the only path that sets activeResolutionRef AND notifies server.
//  4. Polling fallback: if socket push for current resolution not received within
//     POLL_INTERVAL, fetch via REST to ensure 1m candle updates aren't missed.
import { useState, useEffect, useCallback, useRef } from "react";
import { io } from "socket.io-client";
import axios from "axios";

const BACKEND = process.env.REACT_APP_BACKEND_URL || "http://localhost:3299";

// Fallback REST poll: if no socket update received within this window, poll manually.
// Set slightly longer than server REFRESH_MS (65s) to avoid unnecessary requests.
const POLL_INTERVAL_MS = 70000; // 1min 10sec

export function useSocket() {
  const [chartData, setChartData] = useState(null);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const socketRef = useRef(null);

  // The resolution the frontend ACTUALLY wants to display.
  // Only refresh() updates this; socket pushes never change it.
  const activeResolutionRef = useRef(null);
  const activeSymbolRef = useRef(null);

  // Timestamp of last received socket update — used for REST polling fallback
  const lastSocketUpdateRef = useRef(0);
  const pollTimerRef = useRef(null);

  // ── REST poll fallback ──────────────────────────────────────────────────
  // Ensures 1m (and other) candles update even if socket room routing has any gap.
  function startPollFallback() {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    pollTimerRef.current = setInterval(async () => {
      const res = activeResolutionRef.current;
      const sym = activeSymbolRef.current;
      if (!res || !sym) return;

      const age = Date.now() - lastSocketUpdateRef.current;
      if (age < POLL_INTERVAL_MS) return; // socket is delivering — skip

      // Socket hasn't delivered a fresh update — fall back to REST
      try {
        const r = await axios.get(`${BACKEND}/api/chart`, {
          params: { symbol: sym, resolution: res },
        });
        const incoming = r.data?.resolution != null ? Number(r.data.resolution) : null;
        if (incoming === activeResolutionRef.current) {
          setChartData(r.data);
          lastSocketUpdateRef.current = Date.now();
        }
      } catch { /* silent — server may be temporarily busy */ }
    }, POLL_INTERVAL_MS);
  }

  // ── WebSocket ───────────────────────────────────────────────────────────
  useEffect(() => {
    const socket = io(BACKEND, { transports: ["websocket", "polling"] });
    socketRef.current = socket;

    socket.on("connect", () => { setConnected(true); setError(null); });
    socket.on("disconnect", () => setConnected(false));

    socket.on("chart_update", (d) => {
      const incoming = d?.resolution != null ? Number(d.resolution) : null;
      const active = activeResolutionRef.current;

      // Belt-and-suspenders guard: drop pushes that don't match active resolution.
      // (Server-side room routing should already prevent this, but guard anyway.)
      if (active !== null && incoming !== null && incoming !== active) return;

      lastSocketUpdateRef.current = Date.now();
      setChartData(d);
      setLoading(false);
      setError(null);
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
  // This is the ONLY place that updates activeResolutionRef.
  const refresh = useCallback(async (symbol, resolution) => {
    setError(null);
    setLoading(true);
    try {
      const params = {};
      if (symbol) params.symbol = symbol;
      if (resolution != null) {
        params.resolution = resolution;
        // Lock active resolution BEFORE the fetch so that any socket push
        // arriving during the round-trip is also filtered correctly.
        const numRes = Number(resolution);
        activeResolutionRef.current = numRes;
        activeSymbolRef.current = symbol;

        // Tell the server which resolution this client is now viewing.
        // Server will move us to the correct socket room for auto-refresh broadcasts.
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

  return { chartData, connected, loading, error, refresh };
}