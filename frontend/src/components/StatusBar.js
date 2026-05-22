// StatusBar.js
// ─── ORIGINAL logic 100% preserved (symbol search, timeframes, OHLC, market status).
// ─── DUAL button REMOVED — replaced with LAYOUT picker only.
// ─── Single render path for ALL modes (no separate dual/single branch).
// ─────  When panel is narrow, flexWrap kicks in so content wraps to 2nd line.
// ─────  Layout picker only appears on the primary panel (panelIdx 0).
// ─────  Link dot (drawing sync) appears on every panel.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState, memo } from "react";
import { useNavigate } from "react-router-dom";
import { useMarketStatus } from "../hooks/useMarketStatus";
import { useTheme } from "../App";
import { LayoutPicker } from "../pages/ChartsPage";
import SymbolSearch from "./SymbolSearch";

// ── Symbols loader lives in SymbolSearch.js (shared module cache) ─────────

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
  { label: "1W", value: 10080 },
];

// ─── StatusBar ─────────────────────────────────────────────────────────────────
// Props:
//   connected, loading, chartData                — data state
//   onRefresh, symbol, resolution                — symbol/res controls
//   onSymbolChange, onResolutionChange
//   todayMode, onTodayToggle                     — today filter
//   crosshairBar                                 — OHLC display
//   onSidebarToggle                              — sidebar toggle
//   tickStreamActive                             — live tick indicator
//   layoutId, onLayoutChange                     — layout picker (primary panel only)
//   dualMode, onDualToggle                       — KEPT as dead props so callers
//                                                   don't need to be updated yet
// ─────────────────────────────────────────────────────────────────────────────
function StatusBar({
  connected, loading, chartData,
  onRefresh, symbol, resolution,
  onSymbolChange, onResolutionChange,
  todayMode, onTodayToggle,
  crosshairBar,
  onSidebarToggle,
  tickStreamActive,
  // dualMode + onDualToggle kept as accepted props but NOT rendered (DUAL removed)
  dualMode,       // eslint-disable-line no-unused-vars
  onDualToggle,   // eslint-disable-line no-unused-vars
  // Layout picker — only primary panel passes these
  layoutId,
  onLayoutChange,
}) {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();

  const lastCandle = chartData?.candles?.at(-1);
  const displayBar = crosshairBar
    ? { open: crosshairBar.open, high: crosshairBar.high, low: crosshairBar.low, close: crosshairBar.close }
    : lastCandle
      ? { open: lastCandle.open, high: lastCandle.high, low: lastCandle.low, close: lastCandle.close }
      : null;

  const marketStatus = useMarketStatus();
  const isLive = marketStatus === "live";

  // ── Symbol search modal ─────────────────────────────────────────────────
  const [searchOpen, setSearchOpen] = useState(false);

  // ═══════════════════════════════════════════════════════════════════════════
  // SINGLE UNIFIED RENDER — works for any panel width.
  // Uses flexWrap so when a panel is narrow, content wraps to a 2nd line.
  // No separate "dualMode" branch — DUAL is gone entirely.
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <header style={S.bar}>

      {/* Home button */}
      <button
        onClick={() => navigate("/")}
        title="Back to Home"
        style={S.homeBtn}
      >
        <svg viewBox="0 0 20 20" width="13" height="13" fill="currentColor" style={{ display: "block", flexShrink: 0 }}>
          <path d="M10 2L2 8.5V18h6v-5h4v5h6V8.5L10 2z" />
        </svg>
      </button>

      {/* Logo */}
      <div style={S.logo}>
        <img src="/tg-levels-logo.png" alt="TG Levels" style={S.logoImg} />
      </div>

      <div style={S.sep} />

      {/* Symbol button — click to open full search modal */}
      <button
        onClick={() => setSearchOpen(true)}
        title="Search symbol (click to open)"
        style={S.symbolBtn}
      >
        <svg width="10" height="10" viewBox="0 0 20 20" fill="none" style={{ flexShrink: 0, opacity: 0.5 }}>
          <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="2" />
          <path d="M13.5 13.5L17 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 160 }}>
          {symbol || "Symbol…"}
        </span>
      </button>

      {/* Search modal — portal-style, full screen overlay */}
      <SymbolSearch
        isOpen={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelect={(sym) => {
          onSymbolChange(sym);
          onRefresh(sym, resolution);
        }}
      />

      <div style={S.sep} />

      {/* TODAY + Timeframe pills */}
      <div style={S.pillGroup}>
        <button
          onClick={onTodayToggle}
          title="Show only today's signals"
          style={{ ...S.pill, ...(todayMode ? S.pillActiveToday : {}) }}
        >
          TODAY
        </button>
        {TIMEFRAMES.map((tf) => (
          <button
            key={tf.value}
            onClick={() => { onResolutionChange(tf.value); onRefresh(symbol, tf.value); }}
            title={`Switch to ${tf.label} candles`}
            style={{ ...S.pill, ...(resolution === tf.value ? S.pillActiveRes : {}) }}
          >
            {tf.label}
          </button>
        ))}
      </div>

      <div style={S.sep} />

      {/* OHLC */}
      {displayBar && (
        <div style={S.ohlcGroup}>
          <Stat label="O" value={fmt(displayBar.open)} color="var(--text)" />
          <Stat label="H" value={fmt(displayBar.high)} color="var(--green)" />
          <Stat label="L" value={fmt(displayBar.low)} color="var(--red)" />
          <Stat label="C" value={fmt(displayBar.close)}
            color={displayBar.close >= displayBar.open ? "var(--green)" : "var(--red)"} />
        </div>
      )}

      <div style={S.sep} />

      {/* Market status */}
      <div style={S.statusGroup}>
        <div style={{
          ...S.dot,
          background: connected ? (isLive ? "var(--green)" : "var(--red)") : "var(--red)",
        }} />
        <span style={{
          color: connected ? (isLive ? "var(--green)" : "var(--red)") : "var(--red)",
          fontSize: 10, fontWeight: 700, whiteSpace: "nowrap",
        }}>
          {connected ? (isLive ? "Market Live" : "Market Closed") : "OFFLINE"}
        </span>
      </div>

      {/* Spacer pushes right actions to the end */}
      <div style={{ flex: 1, minWidth: 6 }} />

      {/* Right actions */}
      <div style={S.rightActions}>

        {/* Layout picker — only on primary panel */}
        {onLayoutChange && (
          <LayoutPicker currentLayout={layoutId} onSelect={onLayoutChange} />
        )}

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          title={theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
          style={S.actionBtn}
        >
          {theme === "dark" ? "☀" : "🌙"}
        </button>

        {/* Refresh */}
        <button
          onClick={() => onRefresh(symbol, resolution)}
          disabled={loading}
          title="Refresh chart data from server"
          style={{
            ...S.refreshBtn,
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

        {/* Sidebar toggle */}
        <button
          onClick={onSidebarToggle}
          style={S.actionBtn}
          title="Toggle signals / stats panel"
        >
          ☰
        </button>

      </div>
    </header>
  );
}

export default memo(StatusBar);

// ── OHLC stat item ────────────────────────────────────────────────────────────
function Stat({ label, value, color }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
      <span style={{ color: "var(--text3)", fontSize: 10, fontWeight: 600 }}>{label}</span>
      <span style={{ color, fontVariantNumeric: "tabular-nums", fontWeight: 600, fontSize: 11 }}>{value}</span>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
// Single style object that works for any panel width.
// flexWrap: "wrap" lets content spill to 2nd line when panel is narrow.
const S = {
  bar: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "3px 0",
    padding: "4px 8px",
    minHeight: 40,
    background: "var(--bg2)",
    borderBottom: "1px solid var(--border)",
    flexShrink: 0,
    zIndex: 100,
    overflow: "visible",
    boxSizing: "border-box",
  },

  homeBtn: {
    display: "flex", alignItems: "center", gap: 4,
    background: "var(--bg3)",
    border: "1px solid var(--border2)",
    borderRadius: 4,
    color: "var(--text2)",
    fontFamily: "var(--font-mono)",
    fontSize: 10, fontWeight: 700,
    padding: "2px 7px",
    cursor: "pointer",
    letterSpacing: "0.05em",
    flexShrink: 0,
    transition: "background 0.15s, color 0.15s, border-color 0.15s",
    whiteSpace: "nowrap",
  },

  logo: { display: "flex", alignItems: "center", flexShrink: 0, padding: "0 4px" },
  logoImg: { height: 26, width: "auto", objectFit: "contain", display: "block" },

  sep: {
    width: 1,
    alignSelf: "stretch",
    minHeight: 16,
    background: "var(--border)",
    margin: "0 5px",
    flexShrink: 0,
  },

  symbolBtn: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: "var(--bg3)",
    border: "1px solid var(--border2)",
    borderRadius: 4,
    color: "var(--text)",
    fontFamily: "var(--font-mono)",
    fontSize: 10,
    fontWeight: 700,
    padding: "3px 8px",
    cursor: "pointer",
    letterSpacing: "0.04em",
    flexShrink: 1,
    minWidth: 80,
    maxWidth: 220,
    transition: "border-color 0.15s, background 0.15s",
  },

  pillGroup: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: "2px 2px",
    flexShrink: 1,
    minWidth: 0,
  },

  pill: {
    background: "transparent",
    border: "1px solid var(--border2)",
    borderRadius: 4,
    color: "var(--text2)",
    fontFamily: "var(--font-mono)",
    fontSize: 10, fontWeight: 600,
    padding: "2px 5px",
    cursor: "pointer",
    letterSpacing: "0.02em",
    flexShrink: 0,
    whiteSpace: "nowrap",
    transition: "background 0.12s, color 0.12s, border-color 0.12s",
  },

  pillActiveToday: {
    background: "var(--accent)",
    borderColor: "var(--accent)",
    color: "#fff",
  },

  pillActiveRes: {
    background: "rgba(61,132,255,0.22)",
    borderColor: "#3d84ff",
    color: "#3d84ff",
  },

  ohlcGroup: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexShrink: 1,
    flexWrap: "wrap",
    minWidth: 0,
  },

  statusGroup: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    flexShrink: 0,
  },

  dot: {
    width: 6, height: 6,
    borderRadius: "50%",
    flexShrink: 0,
    animation: "pulse 2s infinite",
  },

  rightActions: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    flexShrink: 0,
  },

  actionBtn: {
    background: "var(--bg3)",
    border: "1px solid var(--border2)",
    borderRadius: 4,
    color: "var(--text2)",
    fontSize: 13,
    padding: "2px 8px",
    cursor: "pointer",
    display: "flex", alignItems: "center",
    lineHeight: 1,
    flexShrink: 0,
    transition: "background 0.15s, border-color 0.15s",
  },

  refreshBtn: {
    background: "var(--bg3)",
    border: "1px solid var(--border2)",
    borderRadius: 4,
    color: "var(--text2)",
    fontFamily: "var(--font-mono)",
    fontSize: 10, fontWeight: 600,
    padding: "2px 8px",
    letterSpacing: "0.04em",
    display: "flex", alignItems: "center", gap: 3,
    cursor: "pointer",
    whiteSpace: "nowrap",
    flexShrink: 0,
    transition: "border-color 0.15s, color 0.15s",
  },

};