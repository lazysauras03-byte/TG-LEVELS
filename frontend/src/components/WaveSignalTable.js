/**
 * WaveSignalTable.js
 * Shows the list of wave pivots (HH / LH / HL / LL) with negative wave numbering.
 * Mirrors SignalTable architecture.
 */
import React, { useMemo } from "react";
import { toISTDate, getTodayIST } from "../utils/istUtils";

const WAVE_TYPE_CONFIG = {
  HH: { color: "#00d97e", bg: "rgba(0,217,126,0.08)", icon: "▲▲" },
  LH: { color: "#3d84ff", bg: "rgba(61,132,255,0.08)", icon: "▲" },
  HL: { color: "#ffc135", bg: "rgba(255,193,53,0.08)", icon: "▼" },
  LL: { color: "#ff4560", bg: "rgba(255,69,96,0.08)", icon: "▼▼" },
};

function formatTime(tsMs) {
  if (!tsMs) return "—";
  return new Date(tsMs).toLocaleTimeString("en-IN", {
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata",
  });
}

function formatPrice(p) {
  if (p == null) return "—";
  return Number(p).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

export default function WaveSignalTable({ wavePivots = [], todayMode = false }) {
  const rows = useMemo(() => {
    let src = [...wavePivots];
    if (todayMode) {
      const todayIST = getTodayIST();
      src = src.filter((p) => toISTDate(p.time) === todayIST);
    }
    // newest first (waveNum is negative: -1 = most recent)
    return src.sort((a, b) => b.waveNum - a.waveNum);
  }, [wavePivots, todayMode]);

  if (rows.length === 0) {
    return (
      <div style={{ padding: "20px", color: "var(--text3)", textAlign: "center", fontSize: 12 }}>
        {todayMode ? "No wave pivots today yet." : "No wave pivots yet. Waiting for data…"}
      </div>
    );
  }

  return (
    <div style={{ overflowY: "auto", height: "100%", fontSize: 12 }}>
      <div style={{
        padding: "6px 12px", fontSize: 10, color: "var(--text3)",
        borderBottom: "1px solid var(--border)",
        fontFamily: "var(--font-mono)", letterSpacing: "0.05em",
      }}>
        {rows.length} pivot{rows.length !== 1 ? "s" : ""} · latest first
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border)", color: "var(--text3)" }}>
            <th style={th}>#</th>
            <th style={th}>TYPE</th>
            <th style={th}>SIDE</th>
            <th style={th}>TIME (IST)</th>
            <th style={th}>PRICE</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const cfg = WAVE_TYPE_CONFIG[row.waveType] || WAVE_TYPE_CONFIG.HH;
            return (
              <tr
                key={`${row.waveNum}-${row.time}`}
                style={{
                  borderBottom: "1px solid var(--border)",
                  background: i === 0 ? cfg.bg : "transparent",
                  transition: "background 0.3s",
                }}
              >
                <td style={{ ...td, color: "var(--text3)", fontSize: 10 }}>{row.waveNum}</td>
                <td style={td}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: cfg.color, fontWeight: 700 }}>
                    {cfg.icon} {row.waveType}
                  </span>
                </td>
                <td style={{ ...td, color: row.side === "high" ? "#00d97e" : "#ff4560", fontSize: 10 }}>
                  {row.side === "high" ? "HIGH" : "LOW"}
                </td>
                <td style={{ ...td, color: "var(--text2)" }}>{formatTime(row.time)}</td>
                <td style={{ ...td, fontWeight: 600, color: cfg.color, fontVariantNumeric: "tabular-nums" }}>
                  {formatPrice(row.price)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const th = {
  padding: "8px 12px",
  textAlign: "left",
  fontWeight: 600,
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  position: "sticky",
  top: 0,
  background: "var(--bg2)",
  zIndex: 1,
};
const td = { padding: "7px 12px" };