// ScannerPage.js
// Layout (top→bottom):
//   1. Header — timeframe selector, search, view toggle, scan button
//   2. Stats bar
//   3. TWO PANELS (tabs):
//      A) MOTHERWAVE DASHBOARD — latest wave per symbol, sorted by wave size
//         (uptrend | downtrend columns, then Zone Segregation trays)
//      B) STRATEGIES PANEL — per-strategy tab, TABLE VIEW ONLY
//         (stage filters, table rows — clicking opens chart in new tab with fib drawn)
//   Clicking any stock card/row opens chart in new tab with fib retracement drawn

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { io } from "socket.io-client";
import { BACKEND } from "../config";
import { useTheme } from "../App";
import "./ScannerPage.css";

// ─── Constants ────────────────────────────────────────────────────────────────
const TIMEFRAMES = [
  { value: 1, label: "1m" },
  { value: 3, label: "3m" },
  { value: 5, label: "5m" },
  { value: 15, label: "15m" },
  { value: 60, label: "1h" },
  { value: 1440, label: "1D" },
  { value: 10080, label: "1W" },
];

const STAGE_FILTERS = [
  { key: "all", label: "All" },
  { key: "signals", label: "Full Signal" },
  { key: "partial", label: "Watching" },
  { key: "s1", label: "S1" },
  { key: "mw", label: "Motherwave" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(n, d = 2) {
  if (n == null || !isFinite(n)) return "—";
  return Number(n).toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
}
function fmtTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function tickerOf(sym) {
  const idx = (sym || "").indexOf(":");
  return idx >= 0 ? sym.slice(idx + 1) : sym;
}
function exchangeOf(sym) {
  const idx = (sym || "").indexOf(":");
  return idx >= 0 ? sym.slice(0, idx) : "";
}
function stageLabel(r) {
  if (r.error) return { cls: "error", text: "Error" };
  if (r.patternStage === "s3_complete") return { cls: "s3", text: "S3 ✓" };
  if (r.patternStage === "s2") return { cls: "s2", text: "S2 →" };
  if (r.patternStage === "s1") return { cls: "s1", text: "S1" };
  if (r.patternStage === "trapzone") return { cls: "mw", text: "TrapZone" };
  if (r.patternStage === "motherwave") return { cls: "mw", text: "Motherwave" };
  return { cls: "none", text: "—" };
}
// Fib price: price = toPrice + ratio*(fromPrice-toPrice)
// ratio=0 → tip (toPrice), ratio=1 → origin (fromPrice)
// Uses toPrice/fromPrice (same as motherwave.js) for consistency with toSide checks.
function fibPrice(mw, ratio) {
  const to = mw.toPrice ?? mw.endPrice;
  const from = mw.fromPrice ?? mw.startPrice;
  return to + ratio * (from - to);
}

function getZoneTray(r) {
  if (!r.trapZone || !r.motherwave) return "trap";
  const last = r.lastCandle?.close;
  if (!last) return "trap";
  const mw = r.motherwave;
  const span = Math.abs(mw.fromPrice - mw.toPrice);
  const tol = span * 0.05;

  // NEAR 0.618 — highest priority (HOT zone)
  if (Math.abs(last - fibPrice(mw, 0.618)) <= tol) return "hot618";

  // NEAR 0.382
  if (Math.abs(last - fibPrice(mw, 0.382)) <= tol) return "near382";

  // TRAP ZONE: price between fp(0)=wave tip and fp(0.236)
  // This is the orange highlighted box on the chart — just inside the wave end.
  // BEAR: fp(0)=bottom, fp(0.236)=above it  → low=fp(0), high=fp(0.236)
  // BULL: fp(0)=top,    fp(0.236)=below it  → low=fp(0.236), high=fp(0)
  const tip = fibPrice(mw, 0);      // wave end price
  const ret = fibPrice(mw, 0.236);  // first retracement level
  const trapHigh = Math.max(tip, ret);
  const trapLow = Math.min(tip, ret);
  if (last >= trapLow && last <= trapHigh) return "trap";

  return "other"; // outside trap, 382, 618 — not shown in zone trays
}
function waveSize(r) {
  if (!r.motherwave) return 0;
  return Math.abs((r.motherwave.high || 0) - (r.motherwave.low || 0));
}

// ─── Build chart URL with fib drawing from scanner motherwave ─────────────────
// Backend now stores both:
//   fromPrice/toPrice/fromTime/toTime  (wave segment fields, matching WavesIndicator)
//   startPrice/endPrice/startTime/endTime (alias fields for backward compat)
// FibDashboard formula: p1=toPrice (tip, ratio=0), p2=fromPrice (origin, ratio=1)
function buildChartUrl(symbol, timeframe, mw) {
  if (!mw) {
    const params = new URLSearchParams({ symbol, resolution: String(timeframe) });
    return `/charts?${params.toString()}`;
  }
  // Use fromPrice/toPrice (segment fields) with fallback to startPrice/endPrice
  const fromPrice = mw.fromPrice ?? mw.startPrice;
  const toPrice = mw.toPrice ?? mw.endPrice;
  const fromTime = mw.fromTime ?? mw.startTime;
  const toTime = mw.toTime ?? mw.endTime;

  const fromMs = typeof fromTime === "string" ? new Date(fromTime).getTime() : fromTime;
  const toMs = typeof toTime === "string" ? new Date(toTime).getTime() : toTime;

  const fibDrawing = encodeURIComponent(JSON.stringify({
    p1Price: toPrice,                       // wave TIP → ratio 0
    p1Time: Math.round(toMs / 1000),
    p2Price: fromPrice,                     // wave ORIGIN → ratio 1
    p2Time: Math.round(fromMs / 1000),
  }));

  const params = new URLSearchParams({
    symbol,
    resolution: String(timeframe),
    waveFrom: String(fromMs),
    waveTo: String(toMs),
    fibDrawing,
  });
  return `/charts?${params.toString()}`;
}

// ─── Open chart in new tab ─────────────────────────────────────────────────────
function openChart(symbol, timeframe, mw) {
  window.open(buildChartUrl(symbol, timeframe, mw), "_blank");
}

// ─── MWCard — one stock in the motherwave dashboard ───────────────────────────
function MWCard({ r, timeframe }) {
  const isBull = r.motherwave?.type === "bullish";
  const { cls, text } = stageLabel(r);
  const size = waveSize(r);

  return (
    <div
      className={`mw-card ${isBull ? "mw-bull" : "mw-bear"}`}
      onClick={() => openChart(r.symbol, timeframe, r.motherwave)}
      title="Open chart with Fib drawn"
    >
      <div className="mw-card-top">
        <div className="mw-card-sym">
          <span className="mw-card-ticker">{tickerOf(r.symbol)}</span>
          <span className="mw-card-exch">{exchangeOf(r.symbol)}</span>
        </div>
        <span className={`stage-pill ${cls}`}>{text}</span>
      </div>
      <div className="mw-card-price">{fmt(r.lastCandle?.close)}</div>
      <div className="mw-card-wave">
        <span className={`wave-dir ${isBull ? "bull" : "bear"}`}>
          {isBull ? "▲ Bull" : "▼ Bear"}
        </span>
        <span className="mw-card-size">Δ {fmt(size, 2)}</span>
      </div>
      {r.trapZone && (
        <div className="mw-card-zone">
          Zone {fmt(r.trapZone.low)} – {fmt(r.trapZone.high)}
        </div>
      )}
    </div>
  );
}

// ─── ZoneTray ─────────────────────────────────────────────────────────────────
function ZoneTray({ label, subLabel, items, colorClass, timeframe }) {
  return (
    <div className={`zone-tray ${colorClass}`}>
      <div className="zone-tray-header">
        <div className="zone-tray-title">{label}</div>
        <div className="zone-tray-sub">{subLabel}</div>
        <div className="zone-tray-count">{items.length}</div>
      </div>
      <div className="zone-tray-body">
        {items.length === 0 ? (
          <div className="zone-tray-empty">No stocks in this zone</div>
        ) : (
          items.map(r => (
            <div
              key={r.symbol}
              className="zone-tray-item"
              onClick={() => openChart(r.symbol, timeframe, r.motherwave)}
              title="Open chart with Fib drawn"
            >
              <div className="zone-tray-item-left">
                <span className="zone-tray-sym">{tickerOf(r.symbol)}</span>
                <span className="zone-tray-price">{fmt(r.lastCandle?.close)}</span>
              </div>
              <div className="zone-tray-item-right">
                <span className={`stage-pill ${stageLabel(r).cls}`}>{stageLabel(r).text}</span>
                {r.motherwave && (
                  <span className={`wave-dir ${r.motherwave.type === "bullish" ? "bull" : "bear"}`}>
                    {r.motherwave.type === "bullish" ? "▲" : "▼"}
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function ScannerPage() {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const socketRef = useRef(null);

  // ── State ─────────────────────────────────────────────────────────────────
  const [strategies, setStrategies] = useState([]);
  const [activeStrategy, setActiveStrategy] = useState(null);
  const [results, setResults] = useState([]);
  const [status, setStatus] = useState(null);
  const [stageFilter, setStageFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [progress, setProgress] = useState(null);
  const [loading, setLoading] = useState(false);
  const [lastScan, setLastScan] = useState(null);
  const [mwFilter, setMwFilter] = useState("all"); // "all"|"bull"|"bear"
  const [activePanel, setActivePanel] = useState("motherwave"); // "motherwave"|strategy.id
  const [timeframe, setTimeframe] = useState(() => {
    try { const v = localStorage.getItem("tgg_scanner_tf"); return v ? JSON.parse(v) : 15; }
    catch { return 15; }
  });

  // ── Fetch ─────────────────────────────────────────────────────────────────
  const fetchStatus = useCallback(async () => {
    try {
      const s = await fetch(`${BACKEND}/api/scanner/status`).then(r => r.json());
      setStatus(s);
      setLastScan(s.lastScanAt);
      if (s.strategies?.length) {
        setStrategies(s.strategies);
        setActiveStrategy(prev => prev || s.strategies[0]?.id);
      }
    } catch { }
  }, []);

  const fetchResults = useCallback(async (stratId) => {
    if (!stratId) return;
    try {
      const r = await fetch(`${BACKEND}/api/scanner/results/${stratId}?per_page=500`).then(r => r.json());
      setResults(r.results || []);
    } catch { }
  }, []);

  // ── Socket ────────────────────────────────────────────────────────────────
  useEffect(() => {
    fetchStatus();
    const sock = io(BACKEND, { transports: ["websocket"] });
    socketRef.current = sock;
    sock.on("scanner_start", (d) => {
      setProgress({ total: d.total, done: 0 });
      if (d.strategies?.length) {
        setStrategies(d.strategies);
        setActiveStrategy(prev => prev || d.strategies[0]?.id);
      }
    });
    sock.on("scanner_progress", (d) => setProgress({ total: d.total, done: d.done }));
    sock.on("scanner_complete", (d) => {
      setProgress(null);
      setLastScan(d.scannedAt);
      fetchStatus();
    });
    sock.on("scanner_signal", () => fetchStatus());
    // NOTE: chart websocket is a separate connection — untouched
    return () => sock.disconnect();
  }, [fetchStatus]);

  useEffect(() => {
    if (activeStrategy) fetchResults(activeStrategy);
  }, [activeStrategy, lastScan, fetchResults]);

  // ── Timeframe ─────────────────────────────────────────────────────────────
  function handleTfChange(val) {
    setTimeframe(val);
    localStorage.setItem("tgg_scanner_tf", JSON.stringify(val));
  }

  // ── Trigger / Stop ────────────────────────────────────────────────────────
  async function handleTrigger() {
    if (loading || isRunning) return;
    setLoading(true);
    try {
      await fetch(`${BACKEND}/api/scanner/trigger`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolution: timeframe }),
      });
      setProgress({ total: status?.symbolCount || 0, done: 0 });
    } catch { }
    finally { setLoading(false); }
  }
  async function handleStop() {
    try {
      await fetch(`${BACKEND}/api/scanner/stop`, { method: "POST" });
      setProgress(null);
      fetchStatus();
    } catch { }
  }

  // ── Derived data ──────────────────────────────────────────────────────────
  const isRunning = status?.running || !!progress;
  const pct = progress ? Math.round((progress.done / Math.max(1, progress.total)) * 100) : 0;
  const activeStrat = strategies.find(s => s.id === activeStrategy);
  const tfLabel = TIMEFRAMES.find(t => t.value === timeframe)?.label || `${timeframe}m`;

  // Motherwave dashboard — all results with a motherwave, sorted by wave size desc
  const withMW = useMemo(() =>
    results.filter(r => r.motherwave).sort((a, b) => waveSize(b) - waveSize(a)),
    [results]
  );
  const mwUptrend = useMemo(() => withMW.filter(r => r.motherwave.type === "bullish"), [withMW]);
  const mwDowntrend = useMemo(() => withMW.filter(r => r.motherwave.type === "bearish"), [withMW]);

  // Zone trays — downtrend stocks
  const downWithZone = useMemo(() => mwDowntrend.filter(r => r.trapZone), [mwDowntrend]);
  const trapZoneItems = useMemo(() => downWithZone.filter(r => getZoneTray(r) === "trap"), [downWithZone]);
  const near382Items = useMemo(() => downWithZone.filter(r => getZoneTray(r) === "near382"), [downWithZone]);
  const near618Items = useMemo(() => downWithZone.filter(r => getZoneTray(r) === "hot618"), [downWithZone]);

  // Strategy section filters (table only)
  const stratFiltered = useMemo(() => {
    return results.filter(r => {
      if (search && !r.symbol.toLowerCase().includes(search.toLowerCase())) return false;
      switch (stageFilter) {
        case "signals": return r.patternStage === "s3_complete";
        case "partial": return r.patternStage === "s2";
        case "s1": return r.patternStage === "s1";
        case "mw": return r.patternStage === "motherwave" || r.patternStage === "trapzone";
        default: return true;
      }
    });
  }, [results, search, stageFilter]);

  const counts = useMemo(() => ({
    signals: results.filter(r => r.patternStage === "s3_complete").length,
    partial: results.filter(r => r.patternStage === "s2").length,
    s1: results.filter(r => r.patternStage === "s1").length,
  }), [results]);

  // ── Panel switching ───────────────────────────────────────────────────────
  // When a strategy tab is clicked, switch to that strategy panel
  function handlePanelTab(panelKey) {
    setActivePanel(panelKey);
    if (panelKey !== "motherwave") {
      setActiveStrategy(panelKey);
      setStageFilter("all");
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="scanner-page">

      {/* ══ HEADER ══════════════════════════════════════════════════════════ */}
      <div className="scanner-header">
        <button className="scanner-header-back" onClick={() => navigate("/")}>← Back</button>
        <span className="scanner-header-title">Pattern Scanner</span>

        {/* Timeframe */}
        <div className="scanner-tf-group">
          {TIMEFRAMES.map(tf => (
            <button
              key={tf.value}
              className={`scanner-tf-btn ${timeframe === tf.value ? "active" : ""}`}
              onClick={() => handleTfChange(tf.value)}
              disabled={isRunning}
            >
              {tf.label}
            </button>
          ))}
        </div>

        <div className="scanner-header-spacer" />

        {/* Search */}
        <div className="scanner-header-search-wrap">
          <span className="scanner-search-icon">⌕</span>
          <input
            className="scanner-header-search"
            placeholder="Search symbol…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* View toggle — dashboard/table icons, properly fitted */}
        <div className="scanner-view-toggle">
          <button
            className={`scanner-view-btn ${activePanel === "motherwave" ? "active" : ""}`}
            onClick={() => handlePanelTab("motherwave")}
            title="Motherwave Dashboard"
          >
            {/* Grid/dashboard icon */}
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="1" y="1" width="6" height="6" rx="1" fill="currentColor" opacity="0.9" />
              <rect x="9" y="1" width="6" height="6" rx="1" fill="currentColor" opacity="0.9" />
              <rect x="1" y="9" width="6" height="6" rx="1" fill="currentColor" opacity="0.9" />
              <rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor" opacity="0.9" />
            </svg>
          </button>
          <button
            className={`scanner-view-btn ${activePanel !== "motherwave" ? "active" : ""}`}
            onClick={() => strategies.length > 0 && handlePanelTab(strategies[0]?.id)}
            title="Strategies Table"
          >
            {/* Table/list icon */}
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="1" y="1" width="14" height="2.5" rx="0.75" fill="currentColor" opacity="0.9" />
              <rect x="1" y="5" width="14" height="2.5" rx="0.75" fill="currentColor" opacity="0.5" />
              <rect x="1" y="9" width="14" height="2.5" rx="0.75" fill="currentColor" opacity="0.5" />
              <rect x="1" y="13" width="14" height="2.5" rx="0.75" fill="currentColor" opacity="0.5" />
            </svg>
          </button>
        </div>

        {/* Theme */}
        <button className="scanner-theme-btn" onClick={toggleTheme} title="Toggle theme">
          {theme === "dark" ? "☀" : "🌙"}
        </button>

        {/* Status badge */}
        <div className="scanner-header-status">
          <div className={`scanner-status-dot ${isRunning ? "running" : "idle"}`} />
          {isRunning
            ? `${progress?.done || 0} / ${progress?.total || status?.symbolCount || "?"}`
            : `${status?.symbolCount || 0} symbols · ${strategies.length} strategies`}
        </div>

        {isRunning && (
          <button className="scanner-stop-btn" onClick={handleStop}>⏹ Stop</button>
        )}
        <button
          className="scanner-trigger-btn"
          onClick={handleTrigger}
          disabled={isRunning || loading}
        >
          {isRunning ? `Scanning… ${pct}%` : "▶ Scan Now"}
        </button>
      </div>

      {/* Progress bar */}
      <div className="scanner-progress-bar-wrap">
        <div className="scanner-progress-bar" style={{ width: isRunning ? `${pct}%` : "0%" }} />
      </div>

      {/* ══ STATS BAR ═══════════════════════════════════════════════════════ */}
      <div className="scanner-stats-bar">
        <div className="stat-chip"><span className="stat-chip-label">Scanned</span>    <span className="stat-chip-val accent">{results.length}</span></div>
        <div className="stat-chip"><span className="stat-chip-label">Full Signals</span><span className="stat-chip-val green">{counts.signals}</span></div>
        <div className="stat-chip"><span className="stat-chip-label">Watching (S2)</span><span className="stat-chip-val orange">{counts.partial}</span></div>
        <div className="stat-chip"><span className="stat-chip-label">S1 Formed</span>  <span className="stat-chip-val">{counts.s1}</span></div>
        <div className="stat-chip"><span className="stat-chip-label">Uptrend</span>    <span className="stat-chip-val green">{mwUptrend.length}</span></div>
        <div className="stat-chip"><span className="stat-chip-label">Downtrend</span>  <span className="stat-chip-val red">{mwDowntrend.length}</span></div>
        <div className="stat-chip"><span className="stat-chip-label">Resolution</span> <span className="stat-chip-val accent">{tfLabel}</span></div>
        <div className="stat-chip"><span className="stat-chip-label">Last Scan</span>  <span className="stat-chip-val" style={{ fontSize: 11 }}>{lastScan ? fmtTime(lastScan) : "—"}</span></div>
        <div className="stat-chip"><span className="stat-chip-label">Duration</span>   <span className="stat-chip-val">{status?.lastScanDurationMs ? `${(status.lastScanDurationMs / 1000).toFixed(0)}s` : "—"}</span></div>
      </div>

      {/* ══ PANEL TABS ══════════════════════════════════════════════════════ */}
      <div className="scanner-panel-tabs">
        <button
          className={`scanner-panel-tab ${activePanel === "motherwave" ? "active" : ""}`}
          onClick={() => handlePanelTab("motherwave")}
        >
          Motherwave Dashboard
        </button>
        {strategies.map(s => (
          <button
            key={s.id}
            className={`scanner-panel-tab ${activePanel === s.id ? "active" : ""}`}
            onClick={() => handlePanelTab(s.id)}
            title={s.description}
          >
            {s.name}
          </button>
        ))}
      </div>

      {/* ══ BODY ════════════════════════════════════════════════════════════ */}
      <div className="scanner-body">

        {/* ── PANEL A: MOTHERWAVE DASHBOARD ───────────────────────────────── */}
        {activePanel === "motherwave" && (
          <div className="scanner-section mw-section">

            <div className="mw-section-header">
              <div className="mw-section-header-left">
                <span className="mw-section-title">Motherwave Dashboard</span>
                <span className="mw-section-sub">Latest motherwave per symbol on {tfLabel} — sorted by wave size ↓</span>
              </div>
              {/* MW direction filter */}
              <div className="mw-dir-filter">
                {[
                  { key: "all", label: `All (${withMW.length})` },
                  { key: "bull", label: `▲ Bull (${mwUptrend.length})` },
                  { key: "bear", label: `▼ Bear (${mwDowntrend.length})` },
                ].map(f => (
                  <button
                    key={f.key}
                    className={`mw-dir-btn ${mwFilter === f.key ? "active" : ""}`}
                    onClick={() => setMwFilter(f.key)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {withMW.length === 0 ? (
              <div className="scanner-empty">
                <div className="scanner-empty-icon">〰</div>
                <div className="scanner-empty-title">No motherwave data yet</div>
                <div className="scanner-empty-sub">Click ▶ Scan Now to populate.</div>
              </div>
            ) : (
              <>
                {/* Trend columns */}
                <div className="mw-trend-columns">
                  {/* Uptrend */}
                  <div className="trend-column uptrend-col">
                    <div className="trend-col-header">
                      <span className="trend-col-arrow">▲</span>
                      <span className="trend-col-title">UPTREND</span>
                      <span className="trend-col-count">
                        {mwFilter === "bear" ? 0 : mwUptrend.length} stocks
                      </span>
                    </div>
                    <div className="trend-col-body">
                      {(mwFilter === "bear" ? [] : mwUptrend).length === 0 ? (
                        <div className="trend-col-empty">No uptrend stocks</div>
                      ) : (
                        (mwFilter === "bear" ? [] : mwUptrend).map(r =>
                          <MWCard key={r.symbol} r={r} timeframe={timeframe} />
                        )
                      )}
                    </div>
                  </div>

                  {/* Downtrend */}
                  <div className="trend-column downtrend-col">
                    <div className="trend-col-header">
                      <span className="trend-col-arrow">▼</span>
                      <span className="trend-col-title">DOWNTREND</span>
                      <span className="trend-col-count">
                        {mwFilter === "bull" ? 0 : mwDowntrend.length} stocks
                      </span>
                    </div>
                    <div className="trend-col-body">
                      {(mwFilter === "bull" ? [] : mwDowntrend).length === 0 ? (
                        <div className="trend-col-empty">No downtrend stocks</div>
                      ) : (
                        (mwFilter === "bull" ? [] : mwDowntrend).map(r =>
                          <MWCard key={r.symbol} r={r} timeframe={timeframe} />
                        )
                      )}
                    </div>
                  </div>
                </div>

                {/* Zone segregation — downtrend only */}
                <div className="zone-section">
                  <div className="zone-section-title">
                    Zone Segregation
                    <span className="zone-section-sub">Downtrend stocks sorted by Fibonacci zone</span>
                  </div>
                  <div className="zone-trays">
                    <ZoneTray
                      label="TRAP ZONE"
                      subLabel="Between fp(0) and fp(0.236) — at wave tip"
                      items={trapZoneItems}
                      colorClass="tray-trap"
                      timeframe={timeframe}
                    />
                    <ZoneTray
                      label="NEAR 0.382"
                      subLabel="Within 5% of the 0.382 Fib level"
                      items={near382Items}
                      colorClass="tray-382"
                      timeframe={timeframe}
                    />
                    <ZoneTray
                      label="NEAR 0.618 (HOT)"
                      subLabel="Within 5% of the 0.618 Fib level"
                      items={near618Items}
                      colorClass="tray-618"
                      timeframe={timeframe}
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── PANEL B: STRATEGY TABLE ──────────────────────────────────────── */}
        {activePanel !== "motherwave" && (
          <div className="scanner-section strat-section">
            {/* Strategy description */}
            {activeStrat && (
              <div className="scanner-strategy-desc">{activeStrat.description}</div>
            )}

            {/* Stage filters + meta */}
            <div className="scanner-controls">
              {STAGE_FILTERS.map(f => (
                <button
                  key={f.key}
                  className={`scanner-filter-btn ${stageFilter === f.key ? "active" : ""}`}
                  onClick={() => setStageFilter(f.key)}
                >
                  {f.label}
                  {f.key === "signals" && counts.signals > 0 &&
                    <span className="scanner-count-badge green">{counts.signals}</span>}
                  {f.key === "partial" && counts.partial > 0 &&
                    <span className="scanner-count-badge orange">{counts.partial}</span>}
                  {f.key === "s1" && counts.s1 > 0 &&
                    <span className="scanner-count-badge">{counts.s1}</span>}
                </button>
              ))}
              <div className="scanner-controls-spacer" />
              <span className="scanner-last-scan">
                {lastScan ? `Last: ${fmtTime(lastScan)}` : "Not scanned yet"}
              </span>
              <span className="scanner-res-badge">{tfLabel}</span>
            </div>

            {/* Table content */}
            {!activeStrategy ? (
              <div className="scanner-empty">
                <div className="scanner-empty-icon">📋</div>
                <div className="scanner-empty-title">No strategies loaded</div>
                <div className="scanner-empty-sub">Click ▶ Scan Now to initialise.</div>
              </div>
            ) : stratFiltered.length === 0 ? (
              <div className="scanner-empty">
                <div className="scanner-empty-icon">🔍</div>
                <div className="scanner-empty-title">
                  {results.length === 0 ? "No scan results yet" : "No matches"}
                </div>
                <div className="scanner-empty-sub">
                  {results.length === 0
                    ? "Click ▶ Scan Now to run across all symbols."
                    : "Try a different filter or search term."}
                </div>
              </div>
            ) : (
              <div className="scanner-table-wrap">
                <table className="scanner-table">
                  <thead>
                    <tr>
                      <th>Symbol</th>
                      <th>Stage</th>
                      <th>Wave</th>
                      <th>Trap High</th>
                      <th>Trap Low</th>
                      <th>S1 Close</th>
                      <th>S2 Close</th>
                      <th>S3 Close</th>
                      <th>Last Price</th>
                      <th>Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stratFiltered.map(r => {
                      const { cls, text } = stageLabel(r);
                      return (
                        <tr
                          key={r.symbol}
                          className="scanner-table-row"
                          onClick={() => openChart(r.symbol, timeframe, r.motherwave)}
                          title="Open chart with Fib drawn"
                        >
                          <td>
                            <div className="symbol-cell">{tickerOf(r.symbol)}</div>
                            <div className="symbol-ticker">{exchangeOf(r.symbol)}</div>
                          </td>
                          <td><span className={`stage-pill ${cls}`}>{text}</span></td>
                          <td>
                            {r.motherwave
                              ? <span className={`wave-dir ${r.motherwave.type === "bullish" ? "bull" : "bear"}`}>
                                {r.motherwave.type === "bullish" ? "▲ Bull" : "▼ Bear"}
                              </span>
                              : <span style={{ color: "var(--text3)" }}>—</span>}
                          </td>
                          <td className="price-cell">{fmt(r.trapZone?.high)}</td>
                          <td className="price-cell">{fmt(r.trapZone?.low)}</td>
                          <td className={`price-cell ${r.s1 ? "red" : ""}`}>{fmt(r.s1?.close)}</td>
                          <td className={`price-cell ${r.s2 ? "green" : ""}`}>{fmt(r.s2?.close)}</td>
                          <td className={`price-cell ${r.s3 ? "red" : ""}`}>{fmt(r.s3?.close)}</td>
                          <td className="price-cell">{fmt(r.lastCandle?.close)}</td>
                          <td style={{ color: "var(--text3)", fontSize: 10 }}>{fmtTime(r.scannedAt)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

      </div>{/* end scanner-body */}
    </div>
  );
}