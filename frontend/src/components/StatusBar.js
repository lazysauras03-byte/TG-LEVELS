import React from "react";

function fmt(n) {
  if (n == null) return "—";
  return Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

export default function StatusBar({
  connected, loading, chartData,
  onRefresh, symbol, resolution,
  onSymbolChange, onResolutionChange,
}) {
  const lastUpdate = chartData?.lastUpdate
    ? new Date(chartData.lastUpdate).toLocaleTimeString("en-IN", {
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    })
    : null;

  const lastCandle = chartData?.candles?.at(-1);

  return (
    <header style={styles.bar}>

      <div style={styles.logo}>
        <span style={styles.logoT}>TG</span>
        <span style={styles.logoSub}>DASHBOARD</span>
      </div>

      <div style={styles.group}>
        <input
          value={symbol}
          onChange={(e) => onSymbolChange(e.target.value)}
          style={styles.input}
          placeholder="NSE:NIFTY50-INDEX"
        />
        <select
          value={resolution}
          onChange={(e) => onResolutionChange(Number(e.target.value))}
          style={styles.select}
        >
          {[1, 3, 5, 10, 15, 30, 60].map((r) => (
            <option key={r} value={r}>{r}m</option>
          ))}
        </select>
        <button
          onClick={() => onRefresh(symbol, resolution)}
          disabled={loading}
          style={{ ...styles.btn, opacity: loading ? 0.6 : 1 }}
        >
          {loading ? "↻ …" : "↻ Refresh"}
        </button>
      </div>

      {lastCandle && (
        <div style={styles.group}>
          <Stat label="C" value={fmt(lastCandle.close)} color="var(--text)" />
          <Stat label="H" value={fmt(lastCandle.high)} color="var(--green)" />
          <Stat label="L" value={fmt(lastCandle.low)} color="var(--red)" />
        </div>
      )}

      {chartData?.balance != null && (
        <div style={styles.group}>
          <Stat label="BAL" value={"₹" + fmt(chartData.balance)} color="var(--accent)" />
        </div>
      )}

      <div style={styles.group}>
        <div style={{ ...styles.dot, background: connected ? "var(--green)" : "var(--red)" }} />
        <span style={{ color: connected ? "var(--green)" : "var(--red)", fontSize: 11 }}>
          {connected ? "LIVE" : "OFFLINE"}
        </span>
        {lastUpdate && (
          <span style={{ color: "var(--text3)", fontSize: 11, marginLeft: 8 }}>
            {lastUpdate}
          </span>
        )}
      </div>

    </header>
  );
}

function Stat({ label, value, color }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
      <span style={{ color: "var(--text3)", fontSize: 10, fontWeight: 600 }}>{label}</span>
      <span style={{ color, fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>{value}</span>
    </div>
  );
}

const styles = {
  bar: {
    display: "flex", alignItems: "center", gap: 20,
    padding: "0 20px", height: 52,
    background: "var(--bg2)", borderBottom: "1px solid var(--border)",
    flexShrink: 0, flexWrap: "wrap",
  },
  logo: { display: "flex", alignItems: "baseline", gap: 6 },
  logoT: { fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 18, color: "var(--text)", letterSpacing: "-0.03em" },
  logoSub: { fontSize: 10, color: "var(--accent)", fontWeight: 600, letterSpacing: "0.05em" },
  group: { display: "flex", alignItems: "center", gap: 8, padding: "0 12px", borderLeft: "1px solid var(--border)" },
  input: { background: "var(--bg3)", border: "1px solid var(--border2)", borderRadius: 5, color: "var(--text)", fontFamily: "var(--font-mono)", fontSize: 11, padding: "4px 8px", width: 180, outline: "none" },
  select: { background: "var(--bg3)", border: "1px solid var(--border2)", borderRadius: 5, color: "var(--text)", fontFamily: "var(--font-mono)", fontSize: 11, padding: "4px 6px", outline: "none", cursor: "pointer" },
  btn: { background: "var(--accent-dim)", border: "1px solid var(--accent)", borderRadius: 5, color: "var(--accent)", fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600, padding: "4px 12px", transition: "opacity 0.2s" },
  dot: { width: 7, height: 7, borderRadius: "50%", animation: "pulse 2s infinite" },
};