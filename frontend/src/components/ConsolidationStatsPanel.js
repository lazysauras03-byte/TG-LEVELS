/**
 * ConsolidationStatsPanel.js
 *
 * Stats panel for the Consolidation indicator — mirrors WaveStatsPanel pattern.
 * Receives the same `zones` array as ConsolidationZoneTable.
 *
 * Each zone shape:
 *   { startBarIndex, endBarIndex, top, bottom, broken, breakDir,
 *     hhBar, llBar, hhPrice, llPrice, startTime, endTime, status }
 *
 * Connected to: ChartsPage → sidebar "Stats" tab of the Consolidation section.
 */
import React, { useMemo } from "react";

function fmtPrice(p) {
  if (p == null) return "—";
  return Number(p).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function toISTDate(tsMs) {
  if (!tsMs) return "";
  return new Date(tsMs).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
}

function getTodayIST() {
  return new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
}

export default function ConsolidationStatsPanel({ zones = [], todayMode = false }) {
  const todayIST = useMemo(() => getTodayIST(), []);

  const filtered = useMemo(() => {
    if (!todayMode) return zones;
    return zones.filter((z) => toISTDate(z.startTime) === todayIST);
  }, [zones, todayMode, todayIST]);

  const counts = useMemo(() => {
    const c = { active: 0, up: 0, down: 0 };
    filtered.forEach((z) => {
      if (z.status === "up")   c.up++;
      else if (z.status === "down") c.down++;
      else c.active++;
    });
    return c;
  }, [filtered]);

  // Width stats — how wide each zone is (endBarIndex - startBarIndex)
  const widths = useMemo(() => filtered.map((z) => z.endBarIndex - z.startBarIndex), [filtered]);
  const avgWidth = widths.length ? Math.round(widths.reduce((a, b) => a + b, 0) / widths.length) : null;
  const maxWidth = widths.length ? Math.max(...widths) : null;

  // Zone height (top - bottom) — tightness of consolidation
  const heights = useMemo(() =>
    filtered.map((z) => (z.top != null && z.bottom != null ? z.top - z.bottom : null)).filter((v) => v != null),
    [filtered]
  );
  const avgHeight = heights.length
    ? Number((heights.reduce((a, b) => a + b, 0) / heights.length).toFixed(2))
    : null;

  // Latest zone (highest startBarIndex)
  const latestZone = filtered.length
    ? filtered.reduce((a, b) => (b.startBarIndex > a.startBarIndex ? b : a))
    : null;

  const displayLabel = todayMode ? "TODAY" : "1 MONTH";

  if (!filtered.length) {
    return (
      <div style={{ padding: "20px 14px", textAlign: "center", color: "var(--text3)", fontSize: 11 }}>
        No consolidation zones detected
      </div>
    );
  }

  return (
    <div style={styles.panel}>

      {/* Period badge */}
      <div style={{
        ...styles.periodBadge,
        borderColor: todayMode ? "var(--accent)" : "var(--border2)",
        color: todayMode ? "var(--accent)" : "var(--text3)",
      }}>
        {displayLabel} · {filtered.length} zone{filtered.length !== 1 ? "s" : ""}
      </div>

      {/* Zone status counts */}
      <div style={styles.sectionTitle}>ZONE STATUS</div>
      <div style={styles.grid}>
        <StatCard label="ACTIVE" value={counts.active} color="#3d84ff" />
        <StatCard label="BROKE UP" value={counts.up}   color="#00d97e" />
        <StatCard label="BROKE DN" value={counts.down}  color="#ff4560" />
        <StatCard label="TOTAL"    value={filtered.length} color="var(--accent)" />
      </div>

      {/* Zone geometry */}
      <div style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 14 }}>
        <div style={styles.sectionTitle}>ZONE GEOMETRY</div>
        <Row label="AVG WIDTH (bars)" value={avgWidth ?? "—"} />
        <Row label="MAX WIDTH (bars)" value={maxWidth ?? "—"} />
        <Row label="AVG HEIGHT (pts)" value={avgHeight != null ? fmtPrice(avgHeight) : "—"} />
      </div>

      {/* Latest zone detail */}
      {latestZone && (
        <div style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 14 }}>
          <div style={styles.sectionTitle}>LATEST ZONE</div>
          <Row
            label="STATUS"
            value={latestZone.status === "up" ? "BROKE UP" : latestZone.status === "down" ? "BROKE DN" : "ACTIVE"}
            valueColor={latestZone.status === "up" ? "#00d97e" : latestZone.status === "down" ? "#ff4560" : "#3d84ff"}
          />
          <Row label="TOP"    value={`₹${fmtPrice(latestZone.top)}`}    />
          <Row label="BOTTOM" value={`₹${fmtPrice(latestZone.bottom)}`} />
          <Row label="WIDTH"  value={`${latestZone.endBarIndex - latestZone.startBarIndex} bars`} />
        </div>
      )}

      {/* Legend */}
      <div style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 14 }}>
        <div style={styles.sectionTitle}>LEGEND</div>
        <LegendRow color="#3d84ff" icon="◈" label="ACTIVE — price still inside zone" />
        <LegendRow color="#00d97e" icon="▲" label="BROKE UP — bullish breakout" />
        <LegendRow color="#ff4560" icon="▼" label="BROKE DN — bearish breakdown" />
      </div>

    </div>
  );
}

function StatCard({ label, value, color }) {
  return (
    <div style={{ background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 14px" }}>
      <div style={{ color: "var(--text3)", fontSize: 10, fontWeight: 600, marginBottom: 4 }}>{label}</div>
      <div style={{ color, fontSize: 22, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}

function Row({ label, value, valueColor }) {
  return (
    <div style={styles.row}>
      <span style={styles.label}>{label}</span>
      <span style={{ color: valueColor || "var(--text)", fontSize: 12, fontVariantNumeric: "tabular-nums", fontWeight: valueColor ? 700 : 400 }}>
        {value}
      </span>
    </div>
  );
}

function LegendRow({ color, icon, label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
      <span style={{ color, fontSize: 12, width: 16 }}>{icon}</span>
      <span style={{ color: "var(--text2)", fontSize: 11 }}>{label}</span>
    </div>
  );
}

const styles = {
  panel: { padding: "14px", height: "100%", overflowY: "auto" },
  periodBadge: {
    display: "inline-block", border: "1px solid", borderRadius: 4,
    padding: "2px 8px", fontSize: 10, fontWeight: 700,
    letterSpacing: "0.06em", marginBottom: 14, fontFamily: "var(--font-mono)",
  },
  sectionTitle: {
    color: "var(--text3)", fontSize: 10, fontWeight: 700,
    letterSpacing: "0.1em", marginBottom: 10, textTransform: "uppercase",
  },
  grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 },
  row: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    marginBottom: 8, fontSize: 12,
  },
  label: { color: "var(--text3)", fontSize: 10, fontWeight: 600, textTransform: "uppercase" },
};
