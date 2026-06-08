import React, { useMemo } from "react";
import { toISTDate, getTodayIST } from "../utils/istUtils";

const TYPE_CONFIG = {
  NH: { label: "NH", bg: "var(--green-dim)", color: "var(--green)", icon: "▼" },
  NL: { label: "NL", bg: "var(--red-dim)", color: "var(--red)", icon: "▲" },
  BC_HIGH: { label: "BC ↑", bg: "var(--yellow-dim)", color: "var(--yellow)", icon: "⚡" },
  BC_LOW: { label: "BC ↓", bg: "var(--yellow-dim)", color: "var(--yellow)", icon: "⚡" },
};

function formatTime(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString("en-IN", {
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata",
  });
}

function formatPrice(p) {
  if (p == null) return "—";
  return Number(p).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

export default function SignalTable({ signals = [], candles = [], todayMode = false }) {
  const rows = useMemo(() => {
    let src = [...signals];

    // Filter to today only if todayMode — use actual current IST date, not last candle
    if (todayMode) {
      const todayIST = getTodayIST();
      src = src.filter((s) => toISTDate(s.time) === todayIST);
    }

    // Merge BC_HIGH + BC_LOW on same bar into single BC row
    const merged = [];
    const bcBars = new Set();

    // Sort newest first before merging
    src.sort((a, b) => b.time - a.time);

    src.forEach((sig) => {
      if (sig.type === "BC_HIGH" || sig.type === "BC_LOW") {
        const key = sig.barIndex;
        if (!bcBars.has(key)) {
          bcBars.add(key);
          // find the paired BC on same bar
          const pair = src.find(
            (s) => s.barIndex === sig.barIndex &&
              s.type !== sig.type &&
              (s.type === "BC_HIGH" || s.type === "BC_LOW")
          );
          const hi = sig.type === "BC_HIGH" ? sig : pair;
          const lo = sig.type === "BC_LOW" ? sig : pair;
          merged.push({
            type: "BC",
            time: sig.time,
            barIndex: sig.barIndex,
            high: hi?.price,
            low: lo?.price,
          });
        }
      } else {
        merged.push({ ...sig });
      }
    });

    // Final sort: newest first (descending time)
    merged.sort((a, b) => b.time - a.time);

    return merged; // NO slice cap — show all signals for the period
  }, [signals, candles, todayMode]);

  if (rows.length === 0) {
    return (
      <div style={{ padding: "20px", color: "var(--text3)", textAlign: "center", fontSize: 12 }}>
        {todayMode ? "No signals today yet." : "No signals yet. Waiting for data…"}
      </div>
    );
  }

  return (
    <div style={{ overflowY: "auto", height: "100%", fontSize: 12 }}>
      {/* Header row — count reflects current filter */}
      <div style={{
        padding: "6px 12px", fontSize: 10, color: "var(--text3)",
        borderBottom: "1px solid var(--border)",
        fontFamily: "var(--font-mono)", letterSpacing: "0.05em",
      }}>
        {rows.length} signal{rows.length !== 1 ? "s" : ""} · latest first
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border)", color: "var(--text3)" }}>
            <th style={th}>TYPE</th>
            <th style={th}>TIME (IST)</th>
            <th style={th}>PRICE</th>
            <th style={th}>BAR#</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const isBc = row.type === "BC";
            const cfg = isBc
              ? { label: "BC", bg: "var(--yellow-dim)", color: "var(--yellow)", icon: "⚡" }
              : TYPE_CONFIG[row.type] || TYPE_CONFIG.NH;
            const price = isBc
              ? `${formatPrice(row.high)} / ${formatPrice(row.low)}`
              : formatPrice(row.price);

            return (
              <tr
                key={`${row.type}-${row.time}-${i}`}
                style={{
                  borderBottom: "1px solid var(--border)",
                  background: i === 0 ? cfg.bg : "transparent",
                  transition: "background 0.3s",
                }}
              >
                <td style={td}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: cfg.color, fontWeight: 700 }}>
                    {cfg.icon} {cfg.label}
                  </span>
                </td>
                <td style={{ ...td, color: "var(--text2)" }}>{formatTime(row.time)}</td>
                <td style={{ ...td, fontWeight: 600, color: cfg.color, fontVariantNumeric: "tabular-nums" }}>
                  {price}
                </td>
                <td style={{ ...td, color: "var(--text3)" }}>{row.barIndex ?? "—"}</td>
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