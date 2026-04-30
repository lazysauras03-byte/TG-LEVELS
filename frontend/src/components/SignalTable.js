import React, { useMemo } from "react";

const TYPE_CONFIG = {
  NH: { label: "NH", bg: "var(--green-dim)", color: "var(--green)", icon: "▼" },
  NL: { label: "NL", bg: "var(--red-dim)", color: "var(--red)", icon: "▲" },
  BC_HIGH: { label: "BC ↑", bg: "var(--yellow-dim)", color: "var(--yellow)", icon: "⚡" },
  BC_LOW: { label: "BC ↓", bg: "var(--yellow-dim)", color: "var(--yellow)", icon: "⚡" },
};

function formatTime(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function formatPrice(p) {
  if (p == null) return "—";
  return Number(p).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

export default function SignalTable({ signals = [], candles = [] }) {
  // Deduplicate BC signals (BC_HIGH + BC_LOW on same bar → one row)
  const rows = useMemo(() => {
    const merged = [];
    const bcBars = new Set();

    // Reverse so newest first
    const reversed = [...signals].reverse();

    reversed.forEach((sig) => {
      if (sig.type === "BC_HIGH" || sig.type === "BC_LOW") {
        const key = sig.barIndex;
        if (!bcBars.has(key)) {
          bcBars.add(key);
          // Find paired BC
          const pair = signals.find(
            (s) =>
              s.barIndex === sig.barIndex &&
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

    return merged.slice(0, 50);
  }, [signals]);

  if (rows.length === 0) {
    return (
      <div style={{ padding: "20px", color: "var(--text3)", textAlign: "center", fontSize: 12 }}>
        No signals yet. Waiting for data…
      </div>
    );
  }

  return (
    <div style={{ overflowY: "auto", maxHeight: "100%", fontSize: 12 }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border)", color: "var(--text3)" }}>
            <th style={th}>Type</th>
            <th style={th}>Time</th>
            <th style={th}>Price</th>
            <th style={th}>Bar#</th>
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
                key={i}
                style={{
                  borderBottom: "1px solid var(--border)",
                  animation: "fadeIn 0.2s ease",
                  background: i === 0 ? cfg.bg : "transparent",
                  transition: "background 0.3s",
                }}
              >
                <td style={td}>
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      color: cfg.color,
                      fontWeight: 700,
                    }}
                  >
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
};

const td = {
  padding: "7px 12px",
};
