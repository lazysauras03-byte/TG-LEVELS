/**
 * WaveStatsPanel.js
 * Stats panel for the Waves indicator — mirrors StatsPanel architecture.
 */
import React, { useMemo } from "react";

const WAVE_COLORS = {
  HH: "#00d97e",
  LH: "#3d84ff",
  HL: "#ffc135",
  LL: "#ff4560",
};

// Structure bias: majority of wave types
function getBias(counts) {
  const bullish = counts.HH + counts.HL;
  const bearish = counts.LL + counts.LH;
  if (bullish > bearish) return { label: "BULLISH", color: "#00d97e" };
  if (bearish > bullish) return { label: "BEARISH", color: "#ff4560" };
  return { label: "NEUTRAL", color: "#7a8099" };
}

function toISTDate(tsMs) {
  if (!tsMs) return "";
  return new Date(tsMs).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
}
function getTodayIST() {
  return new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
}

export default function WaveStatsPanel({ wavePivots = [], waveSegments = [], todayMode = false }) {
  const filteredPivots = useMemo(() => {
    if (!todayMode) return wavePivots;
    const todayIST = getTodayIST();
    return wavePivots.filter((p) => toISTDate(p.time) === todayIST);
  }, [wavePivots, todayMode]);

  const counts = useMemo(() => {
    const c = { HH: 0, LH: 0, HL: 0, LL: 0 };
    filteredPivots.forEach((p) => { if (c[p.waveType] !== undefined) c[p.waveType]++; });
    return c;
  }, [filteredPivots]);

  const bias = getBias(counts);
  const total = counts.HH + counts.LH + counts.HL + counts.LL;

  const latestPivot = filteredPivots.length > 0
    ? filteredPivots.reduce((a, b) => (b.waveNum > a.waveNum ? b : a))
    : null;

  const displayLabel = todayMode ? "TODAY" : "1 MONTH";

  return (
    <div style={styles.panel}>

      {/* Period label */}
      <div style={{
        ...styles.periodBadge,
        borderColor: todayMode ? "var(--accent)" : "var(--border2)",
        color: todayMode ? "var(--accent)" : "var(--text3)",
      }}>
        {displayLabel} · {filteredPivots.length} pivots
      </div>

      {/* Wave type counts */}
      <div style={styles.sectionTitle}>PIVOT TYPES</div>
      <div style={styles.grid}>
        <StatCard label="HH" value={counts.HH} color={WAVE_COLORS.HH} />
        <StatCard label="LH" value={counts.LH} color={WAVE_COLORS.LH} />
        <StatCard label="HL" value={counts.HL} color={WAVE_COLORS.HL} />
        <StatCard label="LL" value={counts.LL} color={WAVE_COLORS.LL} />
      </div>

      {/* Structure */}
      <div style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 14 }}>
        <div style={styles.sectionTitle}>STRUCTURE</div>
        <div style={styles.row}>
          <span style={styles.label}>BIAS</span>
          <span style={{ color: bias.color, fontWeight: 700 }}>{bias.label}</span>
        </div>
        <div style={styles.row}>
          <span style={styles.label}>TOTAL PIVOTS</span>
          <span style={{ color: "var(--text)" }}>{total}</span>
        </div>
        <div style={styles.row}>
          <span style={styles.label}>WAVE SEGMENTS</span>
          <span style={{ color: "var(--text2)" }}>{waveSegments.length}</span>
        </div>
        {latestPivot && (
          <>
            <div style={styles.row}>
              <span style={styles.label}>LATEST PIVOT</span>
              <span style={{ color: WAVE_COLORS[latestPivot.waveType] || "var(--text)", fontWeight: 700 }}>
                {latestPivot.waveType} · Wave {latestPivot.waveNum}
              </span>
            </div>
            <div style={styles.row}>
              <span style={styles.label}>AT PRICE</span>
              <span style={{ color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>
                ₹{Number(latestPivot.price).toLocaleString("en-IN", { maximumFractionDigits: 2 })}
              </span>
            </div>
          </>
        )}
      </div>

      {/* Legend */}
      <div style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 14 }}>
        <div style={styles.sectionTitle}>WAVE TYPES</div>
        <LegendRow color={WAVE_COLORS.HH} icon="▲▲" label="HH — Higher High (bullish swing)" />
        <LegendRow color={WAVE_COLORS.LH} icon="▲"  label="LH — Lower High (bearish turn)" />
        <LegendRow color={WAVE_COLORS.HL} icon="▼"  label="HL — Higher Low (bullish hold)" />
        <LegendRow color={WAVE_COLORS.LL} icon="▼▼" label="LL — Lower Low (bearish swing)" />
        <LegendRow color="rgba(245,166,35,0.85)" icon="—" label="Wave line segments" />
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
  periodBadge: { display: "inline-block", border: "1px solid", borderRadius: 4, padding: "2px 8px", fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", marginBottom: 14, fontFamily: "var(--font-mono)" },
  sectionTitle: { color: "var(--text3)", fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", marginBottom: 10, textTransform: "uppercase" },
  grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 },
  row: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, fontSize: 12 },
  label: { color: "var(--text3)", fontSize: 10, fontWeight: 600, textTransform: "uppercase" },
};
