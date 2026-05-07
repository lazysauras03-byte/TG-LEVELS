// useSocket.js  — fixed: frontend owns timeframe state, socket updates are
// treated as background data pushes and never hijack the active resolution.
import { useState, useEffect, useCallback, useRef } from "react";
import { io } from "socket.io-client";
import axios from "axios";

const BACKEND = process.env.REACT_APP_BACKEND_URL || "http://localhost:3299";

export function useSocket() {
  const [chartData, setChartData] = useState(null);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const socketRef = useRef(null);

  // The resolution the frontend ACTUALLY wants to display.
  // Only refresh() updates this; socket pushes never touch it.
  const activeResolutionRef = useRef(null);

  // ── WebSocket ───────────────────────────────────────────────────────────
  useEffect(() => {
    const socket = io(BACKEND, { transports: ["websocket", "polling"] });
    socketRef.current = socket;

    socket.on("connect", () => { setConnected(true); setError(null); });
    socket.on("disconnect", () => setConnected(false));

    // CRITICAL FIX: only accept socket pushes that match the resolution the
    // user is currently viewing.  Background scans for other timeframes are
    // silently ignored — they must never cause a timeframe switch.
    socket.on("chart_update", (d) => {
      const incoming = d?.resolution != null ? Number(d.resolution) : null;
      const active = activeResolutionRef.current;

      // If we have an active resolution set and the push doesn't match → drop it.
      if (active !== null && incoming !== null && incoming !== active) return;

      setChartData(d);
      setLoading(false);
      setError(null);
    });

    socket.on("error", (e) => { setError(e.message); setLoading(false); });

    return () => socket.disconnect();
  }, []);

  // ── Initial REST fetch ──────────────────────────────────────────────────
  useEffect(() => {
    setLoading(true);
    axios
      .get(`${BACKEND}/api/chart`)
      .then((r) => {
        // Seed the active resolution from the first successful fetch
        if (r.data?.resolution != null) {
          activeResolutionRef.current = Number(r.data.resolution);
        }
        setChartData(r.data);
        setLoading(false);
      })
      .catch(() => {
        setError(null);
        setLoading(false);
      });
  }, []);

  // ── Refresh (user-triggered or initial) ────────────────────────────────
  // This is the ONLY place that updates activeResolutionRef.
  const refresh = useCallback(async (symbol, resolution) => {
    setError(null);
    try {
      const params = {};
      if (symbol) params.symbol = symbol;
      if (resolution != null) {
        params.resolution = resolution;
        // Lock the active resolution BEFORE the fetch so that any socket
        // push arriving during the round-trip is also filtered correctly.
        activeResolutionRef.current = Number(resolution);
      }
      const res = await axios.post(`${BACKEND}/api/chart/refresh`, null, { params });

      // Double-check: seed resolution from response if we didn't pass one
      if (resolution == null && res.data?.resolution != null) {
        activeResolutionRef.current = Number(res.data.resolution);
      }

      setChartData(res.data);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    }
  }, []);

  return { chartData, connected, loading, error, refresh };
}