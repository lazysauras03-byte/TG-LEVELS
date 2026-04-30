import React, { useMemo } from "react";

const STATE_LABELS = {
  0: { label: "WAIT", color: "#7a8099" },
  1: { label: "TRACKING HIGH", color: "#00d97e" },
  "-1": { label: "TRACKING LOW", color: "#ff4560" },
  2: { label: "TRAIL LOW (post NH)", color: "#ffc135" },
  "-2": { label: "TRAIL HIGH (post NL)", color: "#3d84ff" },
};

export default function StatsPanel({ signals = [], candles = [], currentState, bestPrice }) {
  const counts = useMemo(() => {
    const c = { NH: 0, NL: 0, BC: 0 };
    const bcBars = new Set();
    signals.forEach((s) => {
      if (s.type === "NH") c.NH++;
      else if (s.type === "NL") c.NL++;
      else if ((s.type === "BC_HIGH" || s.type === "BC_LOW") && !bcBars.has(s.barIndex)) {
        bcBars.add(s.barIndex);
        c.BC++;
      }
    });
    return c;
  }, [signals]);

  const stateInfo = STATE_LABELS[String(currentState)] || STATE_LABELS[0];

  const lastCandle = candles?.at(-1);

  return (
    <div style={styles.panel}>
      <div style={styles.title}>SIGNALS</div>

      <div style={styles.grid}>
        <StatCard label="NH" value={counts.NH} color="var(--green)" />
        <StatCard label="NL" value={counts.NL} color="var(--red)" />
        <StatCard label="BC" value={counts.BC} color="var(--yellow)" />
        <StatCard label="TOTAL" value={signals.length} color="var(--accent)" />
      </div>

      <div style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 14 }}>
        <div style={styles.row}>
          <span style={styles.label}>STATE</span>
          <span style={{ color: stateInfo.color, fontWeight: 700 }}>{stateInfo.label}</span>
        </div>
        {bestPrice != null && (
          <div style={styles.row}>
            <span style={styles.label}>BEST PRICE</span>
            <span style={{ color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>
              {Number(bestPrice).toLocaleString("en-IN", { maximumFractionDigits: 2 })}
            </span>
          </div>
        )}
        {lastCandle && (
          <>
            <div style={styles.row}>
              <span style={styles.label}>LAST CLOSE</span>
              <span style={{ color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>
                {Number(lastCandle.close).toLocaleString("en-IN", { maximumFractionDigits: 2 })}
              </span>
            </div>
            <div style={styles.row}>
              <span style={styles.label}>CANDLES</span>
              <span style={{ color: "var(--text2)" }}>{candles.length}</span>
            </div>
          </>
        )}
      </div>

      {/* Legend */}
      <div style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 14 }}>
        <div style={styles.title}>LEGEND</div>
        <LegendRow color="var(--green)" icon="▼" label="NH — New High (EMA9 High touch)" />
        <LegendRow color="var(--red)" icon="▲" label="NL — New Low (EMA9 Low touch)" />
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
  panel: { padding: "16px", height: "100%", overflowY: "auto" },
  title: { color: "var(--text3)", fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", marginBottom: 12, textTransform: "uppercase" },
  grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 },
  row: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, fontSize: 12 },
  label: { color: "var(--text3)", fontSize: 10, fontWeight: 600, textTransform: "uppercase" },
};
