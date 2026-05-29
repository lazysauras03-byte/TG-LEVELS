// ScannerPage.js — Redesigned with Dashboard + Zone views, timeframe selector, theme toggle
import React, { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { io } from "socket.io-client";
import { BACKEND } from "../config";
import { useTheme } from "../App";
import "./ScannerPage.css";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(n, d = 2) {
  if (n == null || !isFinite(n)) return "—";
  return Number(n).toFixed(d);
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

// Zone classification based on Fibonacci levels
function getZoneTray(r) {
  if (!r.trapZone) return "trap";
  const high = r.trapZone.high;
  const low = r.trapZone.low;
  const last = r.lastCandle?.close;
  if (!last || !high || !low) return "trap";
  const range = high - low;
  const fib382 = low + range * 0.382;
  const fib618 = low + range * 0.618;
  const tolerance = range * 0.005; // 0.5% tolerance
  if (Math.abs(last - fib618) <= tolerance * 10) return "hot618";
  if (Math.abs(last - fib382) <= tolerance * 10) return "near382";
  return "trap";
}

// Trend classification
function getTrend(r) {
  if (!r.motherwave) return "neutral";
  return r.motherwave.type === "bullish" ? "uptrend" : "downtrend";
}

const STAGE_FILTERS = [
  { key: "all", label: "All" },
  { key: "signals", label: "Full Signal" },
  { key: "partial", label: "Watching" },
  { key: "s1", label: "S1" },
  { key: "mw", label: "Motherwave" },
];

const TIMEFRAMES = [
  { value: 5, label: "5m" },
  { value: 15, label: "15m" },
  { value: 30, label: "30m" },
  { value: 60, label: "1h" },
  { value: 240, label: "4h" },
  { value: "D", label: "1D" },
];

const VIEW_MODES = [
  { key: "table", label: "Table", icon: "⊞" },
  { key: "dashboard", label: "Dashboard", icon: "⊟" },
];

// ─── Dashboard Card ────────────────────────────────────────────────────────────
function StockCard({ r, navigate, strategy }) {
  const { cls, text } = stageLabel(r);
  const isBull = r.motherwave?.type === "bullish";
  const zone = getZoneTray(r);
  const zoneLabel = zone === "hot618" ? "0.618 HOT" : zone === "near382" ? "0.382" : "TRAP";
  const zoneClass = zone === "hot618" ? "zone-hot" : zone === "near382" ? "zone-382" : "zone-trap";
  return (
    <div
      className={`stock-card ${isBull ? "bull" : "bear"}`}
      onClick={() => navigate(`/charts?symbol=${encodeURIComponent(r.symbol)}`)}
      title="Open chart"
    >
      <div className="stock-card-top">
        <div className="stock-card-symbol">
          <span className="stock-card-name">{tickerOf(r.symbol)}</span>
          <span className="stock-card-exchange">{exchangeOf(r.symbol)}</span>
        </div>
        <span className={`stage-pill ${cls}`}>{text}</span>
      </div>
      <div className="stock-card-price">{fmt(r.lastCandle?.close)}</div>
      <div className="stock-card-meta">
        <span className={`wave-type ${r.motherwave?.type || "none"}`}>
          {r.motherwave ? (isBull ? "▲ Bull" : "▼ Bear") : "—"}
        </span>
        <span className={`zone-badge ${zoneClass}`}>{zoneLabel}</span>
      </div>
      {r.trapZone && (
        <div className="stock-card-zone">
          <span className="stock-card-zone-label">Zone</span>
          <span>{fmt(r.trapZone.low)} – {fmt(r.trapZone.high)}</span>
        </div>
      )}
    </div>
  );
}

// ─── Zone Tray ─────────────────────────────────────────────────────────────────
function ZoneTray({ label, subLabel, items, colorClass, navigate }) {
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
              onClick={() => navigate(`/charts?symbol=${encodeURIComponent(r.symbol)}`)}
            >
              <div className="zone-tray-item-left">
                <span className="zone-tray-sym">{tickerOf(r.symbol)}</span>
                <span className="zone-tray-price">{fmt(r.lastCandle?.close)}</span>
              </div>
              <div className="zone-tray-item-right">
                <span className={`stage-pill ${stageLabel(r).cls}`}>{stageLabel(r).text}</span>
                {r.motherwave && (
                  <span className={`wave-type ${r.motherwave.type}`}>
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

// ─── Component ────────────────────────────────────────────────────────────────
export default function ScannerPage() {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const socketRef = useRef(null);

  const [strategies, setStrategies] = useState([]);
  const [activeStrategy, setActiveStrategy] = useState(null);
  const [results, setResults] = useState([]);
  const [status, setStatus] = useState(null);
  const [stageFilter, setStageFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [progress, setProgress] = useState(null);
  const [loading, setLoading] = useState(false);
  const [lastScan, setLastScan] = useState(null);
  const [viewMode, setViewMode] = useState("table");
  const [timeframe, setTimeframe] = useState(15);

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
    return () => sock.disconnect();
  }, [fetchStatus]);

  useEffect(() => {
    if (activeStrategy) fetchResults(activeStrategy);
  }, [activeStrategy, lastScan, fetchResults]);

  // ── Trigger ───────────────────────────────────────────────────────────────
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

  // ── Filter ────────────────────────────────────────────────────────────────
  const filtered = results.filter((r) => {
    if (search && !r.symbol.toLowerCase().includes(search.toLowerCase())) return false;
    switch (stageFilter) {
      case "signals": return r.patternStage === "s3_complete";
      case "partial": return r.patternStage === "s2";
      case "s1": return r.patternStage === "s1";
      case "mw": return r.patternStage === "motherwave" || r.patternStage === "trapzone";
      default: return true;
    }
  });

  const counts = {
    signals: results.filter(r => r.patternStage === "s3_complete").length,
    partial: results.filter(r => r.patternStage === "s2").length,
    s1: results.filter(r => r.patternStage === "s1").length,
  };

  // Dashboard categorisation
  const withMW = filtered.filter(r => r.motherwave);
  const uptrend = withMW.filter(r => r.motherwave.type === "bullish");
  const downtrend = withMW.filter(r => r.motherwave.type === "bearish");

  // Zone trays (downtrend stocks only)
  const downWithZone = downtrend.filter(r => r.trapZone);
  const trapZone = downWithZone.filter(r => getZoneTray(r) === "trap");
  const near382 = downWithZone.filter(r => getZoneTray(r) === "near382");
  const near618 = downWithZone.filter(r => getZoneTray(r) === "hot618");

  const isRunning = status?.running || !!progress;
  const pct = progress ? Math.round((progress.done / Math.max(1, progress.total)) * 100) : 0;
  const activeStrat = strategies.find(s => s.id === activeStrategy);

  return (
    <div className="scanner-page">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="scanner-header">
        <button className="scanner-header-back" onClick={() => navigate("/")}>← Back</button>
        <span className="scanner-header-title">Pattern Scanner</span>

        {/* Timeframe selector */}
        <div className="scanner-tf-group">
          {TIMEFRAMES.map(tf => (
            <button
              key={tf.value}
              className={`scanner-tf-btn ${timeframe === tf.value ? "active" : ""}`}
              onClick={() => setTimeframe(tf.value)}
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

        {/* View toggle */}
        <div className="scanner-view-toggle">
          {VIEW_MODES.map(v => (
            <button
              key={v.key}
              className={`scanner-view-btn ${viewMode === v.key ? "active" : ""}`}
              onClick={() => setViewMode(v.key)}
              title={v.label}
            >
              {v.icon}
            </button>
          ))}
        </div>

        {/* Theme toggle */}
        <button className="scanner-theme-btn" onClick={toggleTheme} title="Toggle theme">
          {theme === "dark" ? "☀" : "🌙"}
        </button>

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

      {/* ── Progress bar ─────────────────────────────────────────────────── */}
      <div className="scanner-progress-bar-wrap">
        <div className="scanner-progress-bar" style={{ width: isRunning ? `${pct}%` : "0%" }} />
      </div>

      {/* ── Strategy tabs ────────────────────────────────────────────────── */}
      {strategies.length > 0 && (
        <div className="scanner-strategy-tabs">
          {strategies.map((s) => (
            <button
              key={s.id}
              className={`scanner-strategy-tab ${activeStrategy === s.id ? "active" : ""}`}
              onClick={() => { setActiveStrategy(s.id); setStageFilter("all"); setSearch(""); }}
              title={s.description}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      {/* ── Strategy description ─────────────────────────────────────────── */}
      {activeStrat && (
        <div className="scanner-strategy-desc">{activeStrat.description}</div>
      )}

      {/* ── Controls ─────────────────────────────────────────────────────── */}
      <div className="scanner-controls">
        {STAGE_FILTERS.map((f) => (
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
        <span className="scanner-res-badge">
          {status?.resolution || timeframe}m
        </span>
      </div>

      {/* ── Content ──────────────────────────────────────────────────────── */}
      <div className="scanner-content">

        {/* Summary cards */}
        <div className="scanner-summary">
          <div className="scanner-summary-card">
            <div className="scanner-summary-card-label">Scanned</div>
            <div className="scanner-summary-card-value accent">{results.length}</div>
          </div>
          <div className="scanner-summary-card">
            <div className="scanner-summary-card-label">Full Signals</div>
            <div className="scanner-summary-card-value green">{counts.signals}</div>
          </div>
          <div className="scanner-summary-card">
            <div className="scanner-summary-card-label">Watching (S2)</div>
            <div className="scanner-summary-card-value orange">{counts.partial}</div>
          </div>
          <div className="scanner-summary-card">
            <div className="scanner-summary-card-label">S1 Formed</div>
            <div className="scanner-summary-card-value">{counts.s1}</div>
          </div>
          <div className="scanner-summary-card">
            <div className="scanner-summary-card-label">Uptrend</div>
            <div className="scanner-summary-card-value green">{uptrend.length}</div>
          </div>
          <div className="scanner-summary-card">
            <div className="scanner-summary-card-label">Downtrend</div>
            <div className="scanner-summary-card-value red">{downtrend.length}</div>
          </div>
          <div className="scanner-summary-card">
            <div className="scanner-summary-card-label">Resolution</div>
            <div className="scanner-summary-card-value accent">{status?.resolution || timeframe}m</div>
          </div>
          <div className="scanner-summary-card">
            <div className="scanner-summary-card-label">Last Duration</div>
            <div className="scanner-summary-card-value" style={{ fontSize: 14 }}>
              {status?.lastScanDurationMs ? `${(status.lastScanDurationMs / 1000).toFixed(0)}s` : "—"}
            </div>
          </div>
        </div>

        {/* Empty state */}
        {!activeStrategy ? (
          <div className="scanner-empty">
            <div className="scanner-empty-icon">📋</div>
            <div className="scanner-empty-title">No strategies loaded</div>
            <div className="scanner-empty-sub">Click ▶ Scan Now to initialise.</div>
          </div>
        ) : filtered.length === 0 ? (
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
        ) : viewMode === "dashboard" ? (

          /* ═══════════════════════════════════════════════════════════════
             DASHBOARD VIEW — Trend columns + Zone trays
          ═══════════════════════════════════════════════════════════════ */
          <div className="scanner-dashboard">

            {/* Trend columns */}
            <div className="scanner-trends">
              {/* Uptrend column */}
              <div className="trend-column uptrend-col">
                <div className="trend-col-header">
                  <span className="trend-col-arrow">▲</span>
                  <span className="trend-col-title">UPTREND</span>
                  <span className="trend-col-count">{uptrend.length} stocks</span>
                </div>
                <div className="trend-col-body">
                  {uptrend.length === 0 ? (
                    <div className="trend-col-empty">No uptrend stocks found</div>
                  ) : (
                    uptrend.map(r => <StockCard key={r.symbol} r={r} navigate={navigate} />)
                  )}
                </div>
              </div>

              {/* Downtrend column */}
              <div className="trend-column downtrend-col">
                <div className="trend-col-header">
                  <span className="trend-col-arrow">▼</span>
                  <span className="trend-col-title">DOWNTREND</span>
                  <span className="trend-col-count">{downtrend.length} stocks</span>
                </div>
                <div className="trend-col-body">
                  {downtrend.length === 0 ? (
                    <div className="trend-col-empty">No downtrend stocks found</div>
                  ) : (
                    downtrend.map(r => <StockCard key={r.symbol} r={r} navigate={navigate} />)
                  )}
                </div>
              </div>
            </div>

            {/* Zone trays — Downtrend segregation */}
            <div className="scanner-zones-section">
              <div className="scanner-zones-header">
                <span className="scanner-zones-title">Zone Segregation</span>
                <span className="scanner-zones-sub">Downtrend stocks sorted by Fibonacci zone</span>
              </div>
              <div className="scanner-zone-trays">
                <ZoneTray
                  label="TRAP ZONE"
                  subLabel="Between −0.236 and +0.236"
                  items={trapZone}
                  colorClass="tray-trap"
                  navigate={navigate}
                />
                <ZoneTray
                  label="NEAR 0.382"
                  subLabel="Within 0.5% of the 0.382 Fib level"
                  items={near382}
                  colorClass="tray-382"
                  navigate={navigate}
                />
                <ZoneTray
                  label="NEAR 0.618 (HOT)"
                  subLabel="Within 0.5% of the 0.618 Fib level"
                  items={near618}
                  colorClass="tray-618"
                  navigate={navigate}
                />
              </div>
            </div>
          </div>

        ) : (

          /* ═══════════════════════════════════════════════════════════════
             TABLE VIEW (original)
          ═══════════════════════════════════════════════════════════════ */
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
                {filtered.map((r) => {
                  const { cls, text } = stageLabel(r);
                  return (
                    <tr key={r.symbol}>
                      <td>
                        <div
                          className="symbol-cell"
                          onClick={() => navigate(`/charts?symbol=${encodeURIComponent(r.symbol)}`)}
                          title="Open chart"
                        >
                          {tickerOf(r.symbol)}
                        </div>
                        <div className="symbol-ticker">{exchangeOf(r.symbol)}</div>
                      </td>
                      <td><span className={`stage-pill ${cls}`}>{text}</span></td>
                      <td>
                        {r.motherwave
                          ? <span className={`wave-type ${r.motherwave.type}`}>
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
    </div>
  );
}