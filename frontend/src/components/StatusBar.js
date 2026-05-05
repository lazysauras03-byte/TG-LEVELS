import React, { useState, useRef, useEffect, memo } from "react";
import SYMBOLS from "../symbols.json";

// Pre-computed formatter — avoid re-creating on every render
const numFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
function fmt(n) {
  if (n == null) return "—";
  return numFmt.format(Number(n));
}

const TIMEFRAMES = [
  { label: "1m", value: 1 },
  { label: "3m", value: 3 },
  { label: "5m", value: 5 },
  { label: "15m", value: 15 },
  { label: "1h", value: 60 },
  { label: "1D", value: 1440 },
];

function StatusBar({
  connected, loading, chartData,
  onRefresh, symbol, resolution,
  onSymbolChange, onResolutionChange,
  todayMode, onTodayToggle,
  crosshairBar,
  onSidebarToggle,
  onReportClick,
}) {
  const lastUpdate = chartData?.lastUpdate
    ? new Date(chartData.lastUpdate).toLocaleTimeString("en-IN", {
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false, timeZone: "Asia/Kolkata",
    })
    : null;

  const lastCandle = chartData?.candles?.at(-1);
  const displayBar = crosshairBar
    ? { open: crosshairBar.open, high: crosshairBar.high, low: crosshairBar.low, close: crosshairBar.close }
    : lastCandle
      ? { open: lastCandle.open, high: lastCandle.high, low: lastCandle.low, close: lastCandle.close }
      : null;

  // ── Symbol search ──────────────────────────────────────
  const [query, setQuery] = useState(symbol);
  const [suggestions, setSuggestions] = useState([]);
  const [showDrop, setShowDrop] = useState(false);
  const inputRef = useRef(null);
  const dropRef = useRef(null);

  useEffect(() => { setQuery(symbol); }, [symbol]);

  function handleQueryChange(e) {
    const val = e.target.value;
    setQuery(val);
    if (!val) { setSuggestions([]); setShowDrop(false); return; }
    const q = val.toLowerCase();
    const hits = SYMBOLS.filter(
      (s) => s.name.toLowerCase().includes(q) || s.symbol.toLowerCase().includes(q)
    ).slice(0, 10);
    setSuggestions(hits);
    setShowDrop(hits.length > 0);
  }

  function handleSelect(sym) {
    setQuery(sym.symbol);
    setSuggestions([]);
    setShowDrop(false);
    onSymbolChange(sym.symbol);
    onRefresh(sym.symbol, resolution);
  }

  function handleKeyDown(e) {
    if (e.key === "Enter") { setShowDrop(false); onSymbolChange(query); onRefresh(query, resolution); }
    if (e.key === "Escape") setShowDrop(false);
  }

  useEffect(() => {
    function handler(e) {
      if (dropRef.current && !dropRef.current.contains(e.target) &&
        inputRef.current && !inputRef.current.contains(e.target))
        setShowDrop(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <header style={styles.bar}>

      {/* Logo */}
      <div style={styles.logo}>
        <span style={styles.logoT}>TG</span>
        <span style={styles.logoSub}>DASHBOARD</span>
      </div>

      {/* Symbol search */}
      <div style={{ ...styles.group, position: "relative" }}>
        <div style={{ position: "relative" }}>
          <input
            ref={inputRef}
            value={query}
            onChange={handleQueryChange}
            onKeyDown={handleKeyDown}
            onFocus={() => query && setShowDrop(suggestions.length > 0)}
            style={styles.input}
            placeholder="Search symbol…"
            autoComplete="off"
            spellCheck={false}
          />
          {showDrop && (
            <div ref={dropRef} style={styles.dropdown}>
              {suggestions.map((s, i) => (
                <div
                  key={i}
                  style={styles.dropItem}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg2)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  onMouseDown={() => handleSelect(s)}
                >
                  <span style={{ color: "var(--accent)", fontSize: 10, fontWeight: 700, minWidth: 130 }}>
                    {s.symbol}
                  </span>
                  <span style={{ color: "var(--text2)", fontSize: 10 }}>
                    {s.name.length > 34 ? s.name.slice(0, 34) + "…" : s.name}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Timeframe pills: TODAY | 1m | 3m | 5m | 15m | 1h | 1D ── */}
      {/* TODAY = filter signals to today only (doesn't change loaded data)  */}
      {/* Timeframe pills = change resolution + re-fetch from backend        */}
      <div style={styles.pillGroup}>
        <button
          onClick={onTodayToggle}
          title="Show only today's signals on the chart"
          style={{ ...styles.pill, ...(todayMode ? styles.pillActiveToday : {}) }}
        >
          TODAY
        </button>

        {TIMEFRAMES.map((tf) => (
          <button
            key={tf.value}
            onClick={() => {
              onResolutionChange(tf.value);
              onRefresh(symbol, tf.value);
            }}
            title={`Switch to ${tf.label} candles`}
            style={{
              ...styles.pill,
              ...(resolution === tf.value ? styles.pillActiveRes : {}),
            }}
          >
            {tf.label}
          </button>
        ))}
      </div>

      {/* OHLC — crosshair or last candle */}
      {displayBar && (
        <div style={styles.group}>
          <Stat label="O" value={fmt(displayBar.open)} color="var(--text)" />
          <Stat label="H" value={fmt(displayBar.high)} color="var(--green)" />
          <Stat label="L" value={fmt(displayBar.low)} color="var(--red)" />
          <Stat label="C" value={fmt(displayBar.close)}
            color={displayBar.close >= displayBar.open ? "var(--green)" : "var(--red)"} />
        </div>
      )}

      {/* LIVE + last update time */}
      <div style={styles.group}>
        <div style={{ ...styles.dot, background: connected ? "var(--green)" : "var(--red)" }} />
        <span style={{ color: connected ? "var(--green)" : "var(--red)", fontSize: 11 }}>
          {connected ? "LIVE" : "OFFLINE"}
        </span>
        {lastUpdate && (
          <span style={{ color: "var(--text3)", fontSize: 11, marginLeft: 6 }}>
            {lastUpdate} IST
          </span>
        )}
      </div>

      {/* ── Right side: Refresh + Report + Sidebar toggle ── */}
      <div style={styles.rightActions}>
        {/* 📄 Report — opens Charts Report page */}
        <button
          onClick={onReportClick}
          style={styles.reportBtn}
          tabIndex={-1}
        >
        </button>

        {/* ↻ Refresh — fetches latest 1-month data from backend */}
        <button
          onClick={() => onRefresh(symbol, resolution)}
          disabled={loading}
          title="Refresh chart data from server"
          style={{
            ...styles.refreshBtn,
            opacity: loading ? 0.5 : 1,
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          <span style={{
            display: "inline-block",
            animation: loading ? "spin 0.8s linear infinite" : "none",
          }}>↻</span>
          {" "}REFRESH
        </button>

        {/* ☰ Sidebar toggle */}
        <button
          onClick={onSidebarToggle}
          style={styles.sidebarToggle}
          title="Toggle signals / stats panel"
        >
          ☰
        </button>
      </div>

    </header>
  );
}

export default memo(StatusBar);

function Stat({ label, value, color }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <span style={{ color: "var(--text3)", fontSize: 10, fontWeight: 600 }}>{label}</span>
      <span style={{ color, fontVariantNumeric: "tabular-nums", fontWeight: 600, fontSize: 12 }}>{value}</span>
    </div>
  );
}

const styles = {
  bar: {
    display: "flex", alignItems: "center", gap: 6,
    padding: "0 12px", height: 52,
    background: "var(--bg2)", borderBottom: "1px solid var(--border)",
    flexShrink: 0, flexWrap: "nowrap", zIndex: 100, overflow: "visible",
  },
  logo: { display: "flex", alignItems: "baseline", gap: 6, flexShrink: 0 },
  logoT: { fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 18, color: "var(--text)", letterSpacing: "-0.03em" },
  logoSub: { fontSize: 10, color: "var(--accent)", fontWeight: 600, letterSpacing: "0.05em" },
  group: {
    display: "flex", alignItems: "center", gap: 8,
    padding: "0 10px", borderLeft: "1px solid var(--border)", flexShrink: 0,
  },
  input: {
    background: "var(--bg3)", border: "1px solid var(--border2)", borderRadius: 5,
    color: "var(--text)", fontFamily: "var(--font-mono)", fontSize: 11,
    padding: "4px 8px", width: 180, outline: "none",
  },
  pillGroup: {
    display: "flex", alignItems: "center", gap: 3,
    padding: "0 10px", borderLeft: "1px solid var(--border)", flexShrink: 0,
  },
  pill: {
    background: "transparent",
    border: "1px solid var(--border2)",
    borderRadius: 5,
    color: "var(--text2)",
    fontFamily: "var(--font-mono)",
    fontSize: 11, fontWeight: 600,
    padding: "3px 9px",
    cursor: "pointer",
    transition: "background 0.15s, color 0.15s, border-color 0.15s",
    letterSpacing: "0.03em",
    flexShrink: 0,
  },
  // TODAY active — purple/accent tint
  pillActiveToday: {
    background: "var(--accent)",
    borderColor: "var(--accent)",
    color: "#fff",
  },
  // Resolution active — blue tint
  pillActiveRes: {
    background: "rgba(61,132,255,0.25)",
    borderColor: "#3d84ff",
    color: "#3d84ff",
  },
  rightActions: {
    display: "flex", alignItems: "center", gap: 6,
    marginLeft: "auto", flexShrink: 0,
    paddingLeft: 10, borderLeft: "1px solid var(--border)",
  },
  reportBtn: {
    // Invisible but functional — blends into navbar background
    background: "var(--bg2)",
    border: "1px solid var(--bg2)",
    borderRadius: 5,
    color: "var(--bg2)",
    fontFamily: "var(--font-mono)",
    fontSize: 11, fontWeight: 700,
    padding: "4px 12px",
    letterSpacing: "0.04em",
    display: "flex", alignItems: "center", gap: 4,
    cursor: "default",
    flexShrink: 0,
    userSelect: "none",
    outline: "none",
    boxShadow: "none",
  },
  refreshBtn: {
    background: "var(--bg3)",
    border: "1px solid var(--border2)",
    borderRadius: 5,
    color: "var(--text2)",
    fontFamily: "var(--font-mono)",
    fontSize: 11, fontWeight: 600,
    padding: "4px 12px",
    letterSpacing: "0.04em",
    display: "flex", alignItems: "center", gap: 4,
    transition: "border-color 0.15s, color 0.15s",
  },
  sidebarToggle: {
    background: "var(--bg3)",
    border: "1px solid var(--border2)",
    borderRadius: 5,
    color: "var(--text2)",
    fontSize: 15,
    padding: "4px 10px",
    cursor: "pointer",
    lineHeight: 1,
    flexShrink: 0,
  },
  dot: { width: 7, height: 7, borderRadius: "50%", animation: "pulse 2s infinite" },
  dropdown: {
    position: "absolute", top: "calc(100% + 4px)", left: 0,
    background: "var(--bg3)", border: "1px solid var(--border2)",
    borderRadius: 6, zIndex: 9999, minWidth: 340, maxHeight: 260,
    overflowY: "auto", boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
  },
  dropItem: {
    padding: "8px 12px", cursor: "pointer", display: "flex", alignItems: "center",
    gap: 8, borderBottom: "1px solid var(--border)", background: "transparent",
  },
};