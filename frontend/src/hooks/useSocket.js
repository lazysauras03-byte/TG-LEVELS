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

  // ── WebSocket ───────────────────────────────────────
  useEffect(() => {
    const socket = io(BACKEND, { transports: ["websocket", "polling"] });
    socketRef.current = socket;

    socket.on("connect", () => { setConnected(true); setError(null); });
    socket.on("disconnect", () => setConnected(false));
    socket.on("chart_update", (d) => { setChartData(d); setLoading(false); });
    socket.on("error", (e) => { setError(e.message); setLoading(false); });

    return () => socket.disconnect();
  }, []);

  // ── Initial REST fetch ──────────────────────────────
  useEffect(() => {
    setLoading(true);
    axios
      .get(`${BACKEND}/api/chart`)
      .then((r) => { setChartData(r.data); setLoading(false); })
      .catch((e) => {
        // If no token yet, silently show empty chart — no overlay
        setError(null);
        setLoading(false);
      });
  }, []);

  // ── Refresh ─────────────────────────────────────────
  const refresh = useCallback(async (symbol, resolution) => {
    setLoading(true);
    setError(null);
    try {
      const params = {};
      if (symbol) params.symbol = symbol;
      if (resolution) params.resolution = resolution;
      const res = await axios.post(`${BACKEND}/api/chart/refresh`, null, { params });
      setChartData(res.data);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  return { chartData, connected, loading, error, refresh };
}