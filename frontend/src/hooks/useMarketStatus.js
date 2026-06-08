/**
 * useMarketStatus.js
 * ─────────────────────────────────────────────────────────────────
 * Source of truth: ticks flowing from the backend, NOT the clock.
 *
 * Hits /health on mount to get the current state immediately,
 * then re-polls every 30s so the home page dot stays accurate
 * without needing a full WebSocket connection.
 *
 * Returns: "live" | "closed" | "connecting"
 *   "live"       — ticksFlowing: true  (ticks arriving at backend)
 *   "closed"     — ticksFlowing: false (no ticks in watchdog window)
 *   "connecting" — initial state before first /health response
 * ─────────────────────────────────────────────────────────────────
 */
import { useState, useEffect } from "react";
import { BACKEND } from "../config";

export function useMarketStatus() {
  const [status, setStatus] = useState("connecting");

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const r = await fetch(`${BACKEND}/health`);
        if (!r.ok || cancelled) return;
        const data = await r.json();
        if (cancelled) return;
        // ticksFlowing is the single source of truth — set by the backend
        // based on actual tick timestamps, not the clock.
        if (data?.ticksFlowing === true) setStatus("live");
        if (data?.ticksFlowing === false) setStatus("closed");
      } catch {
        // backend unreachable — stay as-is, don't flip to closed
      }
    }

    check();
    const interval = setInterval(check, 30_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []); // no deps — backend URL never changes

  return status; // "live" | "closed" | "connecting"
}