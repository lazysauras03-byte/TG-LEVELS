import React, { useMemo } from "react";
import { toISTDate, getTodayIST } from "../utils/istUtils";

const STATE_LABELS = {
  0: { label: "WAIT", color: "#7a8099" },
  1: { label: "TRACKING HIGH", color: "#00d97e" },
  "-1": { label: "TRACKING LOW", color: "#ff4560" },
  2: { label: "TRAIL LOW (post NH)", color: "#ffc135" },
  "-2": { label: "TRAIL HIGH (post NL)", color: "#3d84ff" },
};

export default function StatsPanel({ signals = [], candles = [], currentState, bestPrice, todayMode = false }) {
  // Filter signals to today if todayMode — same logic as SignalTable
  const filteredSignals = useMemo(() => {
    if (!todayMode) return signals;
    const todayIST = getTodayIST();
    return signals.filter((s) => toISTDate(s.time) === todayIST);
  }, [signals, todayMode]);

  const counts = useMemo(() => {
    const c = { NH: 0, NL: 0, BC: 0 };
    const bcBars = new Set();
    filteredSignals.forEach((s) => {
      if (s.type === "NH") c.NH++;
      else if (s.type === "NL") c.NL++;
      else if ((s.type === "BC_HIGH" || s.type === "BC_LOW") && !bcBars.has(s.barIndex)) {
        bcBars.add(s.barIndex);
        c.BC++;
      }
    });
    return c;
  }, [filteredSignals]);

  const stateInfo = STATE_LABELS[String(currentState)] || STATE_LABELS[0];
  const lastCandle = candles?.at(-1);

  // Today's candles for today-specific stats
  const todayCandles = useMemo(() => {
    if (!todayMode || !candles.length) return candles;
    const todayIST = getTodayIST();
    return candles.filter((c) => toISTDate(c.time) === todayIST);
  }, [candles, todayMode]);

  const displayLabel = todayMode ? "TODAY" : "1 MONTH";

  return (
    <div style={styles.panel}>

      {/* Period label */}
      <div style={{ ...styles.periodBadge, borderColor: todayMode ? "var(--accent)" : "var(--border2)", color: todayMode ? "var(--accent)" : "var(--text3)" }}>
        {displayLabel} · {filteredSignals.length} signals
      </div>

      {/* Signal counts */}
      <div style={styles.sectionTitle}>SIGNALS</div>
      <div style={styles.grid}>
        <StatCard label="NH" value={counts.NH} color="var(--green)" />
        <StatCard label="NL" value={counts.NL} color="var(--red)" />
        <StatCard label="BC" value={counts.BC} color="var(--yellow)" />
        <StatCard label="TOTAL" value={counts.NH + counts.NL + counts.BC} color="var(--accent)" />
      </div>

      {/* Market state */}
      <div style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 14 }}>
        <div style={styles.sectionTitle}>MARKET</div>
        <div style={styles.row}>
          <span style={styles.label}>STATE</span>
          <span style={{ color: stateInfo.color, fontWeight: 700 }}>{stateInfo.label}</span>
        </div>
        {bestPrice != null && (
          <div style={styles.row}>
            <span style={styles.label}>BEST PRICE</span>
            <span style={{ color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>
              ₹{Number(bestPrice).toLocaleString("en-IN", { maximumFractionDigits: 2 })}
            </span>
          </div>
        )}
        {lastCandle && (
          <>
            <div style={styles.row}>
              <span style={styles.label}>LAST CLOSE</span>
              <span style={{ color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>
                ₹{Number(lastCandle.close).toLocaleString("en-IN", { maximumFractionDigits: 2 })}
              </span>
            </div>
            <div style={styles.row}>
              <span style={styles.label}>CANDLES ({displayLabel})</span>
              <span style={{ color: "var(--text2)" }}>{todayMode ? todayCandles.length : candles.length}</span>
            </div>
          </>
        )}
      </div>

      {/* Legend */}
      <div style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 14 }}>
        <div style={styles.sectionTitle}>LEGEND</div>
        <LegendRow color="var(--green)" icon="▼" label="NH — New High (EMA9H touch)" />
        <LegendRow color="var(--red)" icon="▲" label="NL — New Low (EMA9L touch)" />
        <LegendRow color="var(--yellow)" icon="⚡" label="BC — Both sides touched" />
        <LegendRow color="rgba(0,217,126,0.6)" icon="—" label="EMA9 of Highs" />
        <LegendRow color="rgba(255,69,96,0.6)" icon="—" label="EMA9 of Lows" />
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
      <span style={{ color, fontSize: 12, width: 14 }}>{icon}</span>
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