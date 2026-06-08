/**
 * ConsolidationZoneTable.js
 * Shows consolidation zones in sidebar — mirrors WaveSignalTable pattern.
 * No signals, just zones with: #, status, top price, bottom price, time.
 */
import React, { useMemo } from "react";
import { toISTDate, getTodayIST } from "../utils/istUtils";

const STATUS_CONFIG = {
  active: { color: "#3d84ff", bg: "rgba(61,132,255,0.08)", icon: "◈", label: "ACTIVE" },
  up: { color: "#00d97e", bg: "rgba(0,217,126,0.08)", icon: "▲", label: "BROKE UP" },
  down: { color: "#ff4560", bg: "rgba(255,69,96,0.08)", icon: "▼", label: "BROKE DN" },
};

function fmtPrice(p) {
  if (p == null) return "—";
  return Number(p).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function fmtTime(tsMs) {
  if (!tsMs) return "—";
  return new Date(tsMs).toLocaleTimeString("en-IN", {
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata",
  });
}

export default function ConsolidationZoneTable({ zones = [], todayMode }) {
  const todayIST = useMemo(() => getTodayIST(), []);

  const displayed = useMemo(() => {
    const sorted = [...zones].reverse(); // latest first
    if (!todayMode) return sorted;
    return sorted.filter((z) => toISTDate(z.startTime) === todayIST);
  }, [zones, todayMode, todayIST]);

  if (!displayed.length) {
    return (
      <div style={{ padding: "20px 14px", textAlign: "center", color: "var(--text3)", fontSize: 11 }}>
        No consolidation zones detected
      </div>
    );
  }

  return (
    <div style={{ overflowY: "auto", height: "100%" }}>
      {/* Header */}
      <div style={{
        display: "grid", gridTemplateColumns: "28px 60px 1fr 1fr 44px",
        padding: "6px 10px", borderBottom: "1px solid var(--border)",
        position: "sticky", top: 0, background: "var(--bg2)", zIndex: 2,
      }}>
        {["#", "STATUS", "TOP", "BOT", "TIME"].map((h) => (
          <span key={h} style={{ fontSize: 9, fontWeight: 700, color: "var(--text3)", fontFamily: "var(--font-mono)", letterSpacing: "0.07em" }}>
            {h}
          </span>
        ))}
      </div>

      {/* Rows */}
      {displayed.map((z, idx) => {
        const cfg = STATUS_CONFIG[z.status] ?? STATUS_CONFIG.active;
        const num = -(idx); // negative index latest-first
        return (
          <div
            key={`${z.startBarIndex}-${z.status}`}
            style={{
              display: "grid", gridTemplateColumns: "28px 60px 1fr 1fr 44px",
              padding: "8px 10px", borderBottom: "1px solid var(--border)",
              background: idx === 0 ? cfg.bg : "transparent",
              transition: "background 0.12s",
            }}
          >
            {/* # */}
            <span style={{ fontSize: 10, color: "var(--text3)", fontFamily: "var(--font-mono)", fontWeight: 600 }}>
              {num === 0 ? "-1" : num}
            </span>

            {/* Status */}
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ fontSize: 11, color: cfg.color }}>{cfg.icon}</span>
              <span style={{ fontSize: 9, fontWeight: 700, color: cfg.color, fontFamily: "var(--font-mono)", letterSpacing: "0.05em" }}>
                {cfg.label}
              </span>
            </span>

            {/* Top price */}
            <span style={{ fontSize: 11, fontWeight: 700, color: "#00d97e", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}>
              {fmtPrice(z.top)}
            </span>

            {/* Bottom price */}
            <span style={{ fontSize: 11, fontWeight: 700, color: "#ff4560", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}>
              {fmtPrice(z.bottom)}
            </span>

            {/* Time */}
            <span style={{ fontSize: 10, color: "var(--text3)", fontFamily: "var(--font-mono)" }}>
              {fmtTime(z.startTime)}
            </span>
          </div>
        );
      })}
    </div>
  );
}