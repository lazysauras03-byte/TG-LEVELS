// StatusBar.js
// ─── ORIGINAL logic 100% preserved (DUAL button, dual-mode render, all styles).
// ─── NEW additions: LayoutPicker + LinkDotButton imported from ChartsPage.
// ─────  Single/multi panel mode: Layout picker sits alongside the DUAL button.
// ─────  Link dot (drawing sync) sits in right actions on all panels.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState, useRef, useEffect, memo } from "react";
import { useNavigate } from "react-router-dom";
import { useMarketStatus } from "../hooks/useMarketStatus";
import { useTheme } from "../App";
import { BACKEND } from "../config";
// NEW: layout picker + link dot imported from ChartsPage (they are exported there)
import { LayoutPicker, LinkDotButton } from "../pages/ChartsPage";

// Load symbols from backend API (merges symbols.json + Excel files).
// Falls back to empty array gracefully if backend is unavailable.
let _symbolsCache = [];
let _symbolsLoaded = false;
async function loadSymbols() {
  if (_symbolsLoaded) return _symbolsCache;
  try {
    const r = await fetch(`${BACKEND}/api/symbols`);
    if (r.ok) {
      _symbolsCache = await r.json();
    }
  } catch { /* fallback: use empty list */ }
  _symbolsLoaded = true;
  return _symbolsCache;
}

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
  { label: "1W", value: 10080 },
];

function StatusBar({
  connected, loading, chartData,
  onRefresh, symbol, resolution,
  onSymbolChange, onResolutionChange,
  todayMode, onTodayToggle,
  crosshairBar,
  onSidebarToggle,
  tickStreamActive,
  // ── ORIGINAL dual-mode props — only passed by the PRIMARY (left) panel ───
  dualMode,
  onDualToggle,
  // ── NEW: layout picker props — only passed by primary panel ──────────────
  layoutId,
  onLayoutChange,
  // ── NEW: link dot props — passed to every panel ───────────────────────────
  linkColor,
  onSetLink,
}) {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const lastUpdate = chartData?.lastUpdate
    ? new Date(chartData.lastUpdate).toLocaleTimeString("en-IN", {
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hour12: false, timeZone: "Asia/Kolkata",
    })
    : null;

  const marketStatus = useMarketStatus();
  const isLive = marketStatus === "live";

  const lastCandle = chartData?.candles?.at(-1);
  const displayBar = crosshairBar
    ? { open: crosshairBar.open, high: crosshairBar.high, low: crosshairBar.low, close: crosshairBar.close }
    : lastCandle
      ? { open: lastCandle.open, high: lastCandle.high, low: lastCandle.low, close: lastCandle.close }
      : null;

  // ── Symbol search ──────────────────────────────────────
  const [symbols, setSymbols] = useState([]);
  const [query, setQuery] = useState(symbol);
  const [suggestions, setSuggestions] = useState([]);
  const [showDrop, setShowDrop] = useState(false);
  const inputRef = useRef(null);
  const dropRef = useRef(null);

  useEffect(() => {
    loadSymbols().then((list) => setSymbols(list));
  }, []);

  useEffect(() => { setQuery(symbol); }, [symbol]);

  function handleQueryChange(e) {
    const val = e.target.value;
    setQuery(val);
    if (!val.trim()) { setSuggestions([]); setShowDrop(false); return; }
    const q = val.toLowerCase().trim();
    const hits = symbols
      .filter((s) => {
        const nameLower = s.name.toLowerCase();
        const colonIdx = s.symbol.indexOf(":");
        const ticker = (colonIdx >= 0 ? s.symbol.slice(colonIdx + 1) : s.symbol).toLowerCase();
        const tickerBase = ticker.replace(/-(eq|be|index|etf|pp|sm)$/i, "");
        return (
          nameLower.startsWith(q) ||
          nameLower.includes(q) ||
          ticker.startsWith(q) ||
          tickerBase.startsWith(q) ||
          tickerBase.includes(q)
        );
      })
      .sort((a, b) => {
        const colonA = a.symbol.indexOf(":");
        const colonB = b.symbol.indexOf(":");
        const tA = (colonA >= 0 ? a.symbol.slice(colonA + 1) : a.symbol).toLowerCase().replace(/-(eq|be|index|etf|pp|sm)$/i, "");
        const tB = (colonB >= 0 ? b.symbol.slice(colonB + 1) : b.symbol).toLowerCase().replace(/-(eq|be|index|etf|pp|sm)$/i, "");
        const scoreA = tA.startsWith(q) ? 0 : a.name.toLowerCase().startsWith(q) ? 1 : 2;
        const scoreB = tB.startsWith(q) ? 0 : b.name.toLowerCase().startsWith(q) ? 1 : 2;
        if (scoreA !== scoreB) return scoreA - scoreB;
        return a.name.localeCompare(b.name);
      })
      .slice(0, 12);
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

  // ═══════════════════════════════════════════════════════════════════════════
  // DUAL MODE render — ORIGINAL: no logo, flexWrap, compact sizes, wraps to 2 lines
  // NEW additions: link dot in right actions (link dot only, no layout picker in dual)
  // ═══════════════════════════════════════════════════════════════════════════
  if (dualMode) {
    return (
      <header style={D.bar}>

        {/* Symbol search — no logo before it */}
        <div style={{ position: "relative", flexShrink: 1, minWidth: 0 }}>
          <input
            ref={inputRef}
            value={query}
            onChange={handleQueryChange}
            onKeyDown={handleKeyDown}
            onFocus={() => query && setShowDrop(suggestions.length > 0)}
            style={D.input}
            placeholder="Symbol…"
            autoComplete="off"
            spellCheck={false}
          />
          {showDrop && (
            <div ref={dropRef} style={D.dropdown}>
              {suggestions.map((s, i) => (
                <div
                  key={i}
                  style={D.dropItem}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg2)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  onMouseDown={() => handleSelect(s)}
                >
                  <span style={{ color: "var(--accent)", fontSize: 10, fontWeight: 700, minWidth: 110, flexShrink: 0 }}>
                    {s.symbol}
                  </span>
                  <span style={{ color: "var(--text2)", fontSize: 10 }}>
                    {s.name.length > 26 ? s.name.slice(0, 26) + "…" : s.name}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={D.sep} />

        {/* Timeframe pills — wrap when narrow */}
        <div style={D.pillGroup}>
          <button
            onClick={onTodayToggle}
            title="Show only today's signals"
            style={{ ...D.pill, ...(todayMode ? D.pillActiveToday : {}) }}
          >
            TODAY
          </button>
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.value}
              onClick={() => { onResolutionChange(tf.value); onRefresh(symbol, tf.value); }}
              title={`Switch to ${tf.label} candles`}
              style={{ ...D.pill, ...(resolution === tf.value ? D.pillActiveRes : {}) }}
            >
              {tf.label}
            </button>
          ))}
        </div>

        <div style={D.sep} />

        {/* OHLC compact */}
        {displayBar && (
          <div style={D.ohlcGroup}>
            <DualStat label="O" value={fmt(displayBar.open)} color="var(--text)" />
            <DualStat label="H" value={fmt(displayBar.high)} color="var(--green)" />
            <DualStat label="L" value={fmt(displayBar.low)} color="var(--red)" />
            <DualStat label="C" value={fmt(displayBar.close)}
              color={displayBar.close >= displayBar.open ? "var(--green)" : "var(--red)"} />
          </div>
        )}

        <div style={D.sep} />

        {/* Market status */}
        <div style={D.statusGroup}>
          <div style={{
            ...D.dot,
            background: connected ? (isLive ? "var(--green)" : "var(--red)") : "var(--red)",
          }} />
          <span style={{
            color: connected ? (isLive ? "var(--green)" : "var(--red)") : "var(--red)",
            fontSize: 10, fontWeight: 700, whiteSpace: "nowrap",
          }}>
            {connected ? (isLive ? "Market Live" : "Market Closed") : "OFFLINE"}
          </span>
        </div>

        {/* ORIGINAL: DUAL button — highlighted/active, only on primary panel */}
        {onDualToggle && (
          <>
            <div style={D.sep} />
            <button
              onClick={onDualToggle}
              title="Back to single chart"
              style={{ ...D.dualBtn, ...D.dualBtnActive }}
            >
              <svg viewBox="0 0 20 14" width="13" height="10" fill="none"
                stroke="var(--accent,#3d84ff)" strokeWidth="1.9"
                style={{ display: "block", flexShrink: 0 }}
              >
                <rect x="0.9" y="0.9" width="7.8" height="12.2" rx="1.2" />
                <rect x="11.3" y="0.9" width="7.8" height="12.2" rx="1.2" />
              </svg>
              <span>DUAL</span>
            </button>
          </>
        )}

        {/* Spacer pushes actions right */}
        <div style={{ flex: 1, minWidth: 0 }} />

        {/* Refresh + Link Dot + Sidebar */}
        <div style={D.rightActions}>
          {/* NEW: Link dot (drawing sync) */}
          {onSetLink && (
            <LinkDotButton linkColor={linkColor} onSetLink={onSetLink} />
          )}
          <button
            onClick={() => onRefresh(symbol, resolution)}
            disabled={loading}
            title="Refresh chart data from server"
            style={{
              ...D.actionBtn,
              opacity: loading ? 0.5 : 1,
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            <span style={{
              display: "inline-block",
              animation: loading ? "spin 0.8s linear infinite" : "none",
            }}>↻</span>
          </button>
          <button onClick={onSidebarToggle} style={D.actionBtn} title="Toggle signals panel">
            ☰
          </button>
        </div>

      </header>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SINGLE MODE render — ORIGINAL pixel-perfect, nothing changed.
  // NEW additions: Layout picker sits alongside the DUAL button.
  //               Link dot sits in right actions.
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <header style={styles.bar}>

      {/* Home button — ORIGINAL */}
      <button
        onClick={() => navigate("/")}
        title="Back to Home"
        style={styles.homeBtn}
      >
        <svg viewBox="0 0 20 20" width="14" height="14" fill="currentColor" style={{ display: "block", flexShrink: 0 }}>
          <path d="M10 2L2 8.5V18h6v-5h4v5h6V8.5L10 2z" />
        </svg>
        <span>HOME</span>
      </button>

      {/* Logo — ORIGINAL */}
      <div style={styles.logo}>
        <img src="/tg-levels-logo.png" alt="TG Levels" style={styles.logoImg} />
      </div>

      {/* Symbol search — ORIGINAL */}
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

      {/* Timeframe pills — ORIGINAL */}
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
            onClick={() => { onResolutionChange(tf.value); onRefresh(symbol, tf.value); }}
            title={`Switch to ${tf.label} candles`}
            style={{ ...styles.pill, ...(resolution === tf.value ? styles.pillActiveRes : {}) }}
          >
            {tf.label}
          </button>
        ))}
      </div>

      {/* OHLC — ORIGINAL */}
      {displayBar && (
        <div style={styles.group}>
          <Stat label="O" value={fmt(displayBar.open)} color="var(--text)" />
          <Stat label="H" value={fmt(displayBar.high)} color="var(--green)" />
          <Stat label="L" value={fmt(displayBar.low)} color="var(--red)" />
          <Stat label="C" value={fmt(displayBar.close)}
            color={displayBar.close >= displayBar.open ? "var(--green)" : "var(--red)"} />
        </div>
      )}

      {/* Market status — ORIGINAL */}
      <div style={styles.group}>
        <div style={{ ...styles.dot, background: connected ? (isLive ? "var(--green)" : "var(--red)") : "var(--red)" }} />
        <span style={{ color: connected ? (isLive ? "var(--green)" : "var(--red)") : "var(--red)", fontSize: 11 }}>
          {connected ? (isLive ? "Market Live" : "Market Closed") : "OFFLINE"}
        </span>
      </div>

      {/* ORIGINAL: DUAL button in single mode */}
      {onDualToggle && (
        <div style={styles.group}>
          <button
            onClick={onDualToggle}
            title="Split into dual layout"
            style={styles.dualBtn}
          >
            <svg viewBox="0 0 20 14" width="15" height="11" fill="none"
              stroke="currentColor" strokeWidth="1.8"
              style={{ flexShrink: 0, display: "block" }}
            >
              <rect x="0.9" y="0.9" width="7.8" height="12.2" rx="1.2" />
              <rect x="11.3" y="0.9" width="7.8" height="12.2" rx="1.2" />
            </svg>
            <span>DUAL</span>
          </button>
        </div>
      )}

      {/* NEW: Layout picker — sits right after DUAL button, only on primary panel */}
      {onLayoutChange && (
        <div style={styles.group}>
          <LayoutPicker currentLayout={layoutId} onSelect={onLayoutChange} />
        </div>
      )}

      {/* Right side: Theme + Link Dot + Refresh + Sidebar toggle */}
      <div style={styles.rightActions}>
        {/* Theme toggle — ORIGINAL */}
        <button
          onClick={toggleTheme}
          title={theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
          style={styles.themeBtn}
        >
          {theme === "dark" ? "☀" : "🌙"}
        </button>

        {/* NEW: Link dot (drawing sync) */}
        {onSetLink && (
          <LinkDotButton linkColor={linkColor} onSetLink={onSetLink} />
        )}

        {/* Refresh — ORIGINAL */}
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

        {/* Sidebar toggle — ORIGINAL */}
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

// ── Stat for single mode (original) ───────────────────────────────────────────
function Stat({ label, value, color }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <span style={{ color: "var(--text3)", fontSize: 10, fontWeight: 600 }}>{label}</span>
      <span style={{ color, fontVariantNumeric: "tabular-nums", fontWeight: 600, fontSize: 12 }}>{value}</span>
    </div>
  );
}

// ── Stat for dual mode (compact) ──────────────────────────────────────────────
function DualStat({ label, value, color }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
      <span style={{ color: "var(--text3)", fontSize: 9, fontWeight: 700 }}>{label}</span>
      <span style={{ color, fontVariantNumeric: "tabular-nums", fontWeight: 700, fontSize: 10, whiteSpace: "nowrap" }}>
        {value}
      </span>
    </div>
  );
}

// ── ORIGINAL single-mode styles (100% untouched) ──────────────────────────────
const styles = {
  bar: {
    display: "flex", alignItems: "center", gap: 6,
    padding: "0 12px", height: 52,
    background: "var(--bg2)", borderBottom: "1px solid var(--border)",
    flexShrink: 0, flexWrap: "nowrap", zIndex: 100, overflow: "visible",
  },
  homeBtn: {
    display: "flex", alignItems: "center", gap: 5,
    background: "var(--bg3)",
    border: "1px solid var(--border2)",
    borderRadius: 5,
    color: "var(--text2)",
    fontFamily: "var(--font-mono)",
    fontSize: 11, fontWeight: 700,
    padding: "3px 10px",
    cursor: "pointer",
    letterSpacing: "0.05em",
    flexShrink: 0,
    transition: "background 0.15s, color 0.15s, border-color 0.15s",
  },
  logo: { display: "flex", alignItems: "center", flexShrink: 0, padding: "0 4px" },
  logoImg: { height: 32, width: "auto", objectFit: "contain", display: "block" },
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
  pillActiveToday: {
    background: "var(--accent)",
    borderColor: "var(--accent)",
    color: "#fff",
  },
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
  themeBtn: {
    background: "var(--bg3)",
    border: "1px solid var(--border2)",
    borderRadius: 5,
    color: "var(--text2)",
    fontSize: 15,
    padding: "4px 10px",
    cursor: "pointer",
    lineHeight: 1,
    flexShrink: 0,
    transition: "background 0.15s, border-color 0.15s",
  },
  dot: { width: 7, height: 7, borderRadius: "50%", animation: "pulse 2s infinite" },
  dualBtn: {
    display: "flex", alignItems: "center", gap: 5,
    background: "var(--bg3)",
    border: "1px solid var(--border2)",
    borderRadius: 5,
    color: "var(--text2)",
    fontFamily: "var(--font-mono)",
    fontSize: 11, fontWeight: 700,
    padding: "3px 10px",
    cursor: "pointer",
    letterSpacing: "0.05em",
    flexShrink: 0,
    transition: "background 0.15s, color 0.15s, border-color 0.15s",
  },
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

// ── DUAL-mode styles — ORIGINAL compact, no logo, wrappable to 2 lines ────────
const D = {
  bar: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",           // wraps to 2nd line when panel is narrow
    gap: "3px 0",
    padding: "4px 8px",
    minHeight: 40,              // expands naturally to 2 lines if needed
    background: "var(--bg2)",
    borderBottom: "1px solid var(--border)",
    flexShrink: 0,
    zIndex: 100,
    overflow: "visible",
    boxSizing: "border-box",
  },

  // thin vertical separator between groups
  sep: {
    width: 1,
    alignSelf: "stretch",
    minHeight: 16,
    background: "var(--border)",
    margin: "0 5px",
    flexShrink: 0,
  },

  // symbol input — shrinks with panel width, never disappears
  input: {
    background: "var(--bg3)",
    border: "1px solid var(--border2)",
    borderRadius: 4,
    color: "var(--text)",
    fontFamily: "var(--font-mono)",
    fontSize: 10,
    padding: "3px 6px",
    width: "13ch",
    minWidth: "6ch",
    maxWidth: 155,
    outline: "none",
    boxSizing: "border-box",
  },

  // pills — wrap within their group when very narrow
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

  // OHLC — wraps as a unit, values stay on one line each
  ohlcGroup: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    flexShrink: 1,
    flexWrap: "wrap",
    minWidth: 0,
  },

  // market status chip
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

  // ORIGINAL: DUAL button (active state — lit blue in dual mode)
  dualBtn: {
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
    whiteSpace: "nowrap",
    transition: "background 0.12s, color 0.12s, border-color 0.12s",
  },
  dualBtnActive: {
    background: "rgba(61,132,255,0.15)",
    borderColor: "var(--accent,#3d84ff)",
    color: "var(--accent,#3d84ff)",
  },

  // right actions cluster
  rightActions: {
    display: "flex", alignItems: "center", gap: 3,
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
  },

  dropdown: {
    position: "absolute", top: "calc(100% + 4px)", left: 0,
    background: "var(--bg3)", border: "1px solid var(--border2)",
    borderRadius: 6, zIndex: 9999, minWidth: 300, maxHeight: 260,
    overflowY: "auto", boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
  },
  dropItem: {
    padding: "7px 10px", cursor: "pointer", display: "flex", alignItems: "center",
    gap: 8, borderBottom: "1px solid var(--border)", background: "transparent",
  },
};