// StrategiesPage.js
// Route: /strategies          → strategy picker (list of cards)
// Route: /strategies/:id      → full motherwave dashboard for that strategy
//
// Data flow (REST now, WebSocket-ready):
//   - GET /api/scanner/status       → strategies list + symbolCount
//   - GET /api/scanner/results/:id  → all results for chosen strategy
//   - Socket events wired up: scanner_complete → refetch, scanner_signal → refetch
//
// WebSocket upgrade path (when ready):
//   Replace fetchResults() body with a socket subscription on "strategy_results"
//   No component changes needed — state shape is identical.

import React, {
  useState, useEffect, useCallback, useRef, useMemo
} from "react";
import { useNavigate, useParams } from "react-router-dom";
import { io } from "socket.io-client";
import { BACKEND } from "../config";
import { useTheme } from "../App";
import "./StrategiesPage.css";

// ─── Helpers (identical to ScannerPage so charts open with same fib logic) ────
function fmt(n, d = 2) {
  if (n == null || !isFinite(n)) return "—";
  return Number(n).toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
}
function fmtTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-IN", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
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
  if (r.error)                          return { cls: "error", text: "Error" };
  if (r.patternStage === "s3_complete") return { cls: "s3",    text: "S3 ✓" };
  if (r.patternStage === "s2")          return { cls: "s2",    text: "S2 →" };
  if (r.patternStage === "s1")          return { cls: "s1",    text: "S1" };
  if (r.patternStage === "trapzone")    return { cls: "mw",    text: "TrapZone" };
  if (r.patternStage === "motherwave")  return { cls: "mw",    text: "Motherwave" };
  return { cls: "none", text: "—" };
}
function fibPrice(mw, ratio) {
  const to   = mw.toPrice   ?? mw.endPrice;
  const from = mw.fromPrice ?? mw.startPrice;
  return to + ratio * (from - to);
}
function waveSize(r) {
  if (!r.motherwave) return 0;
  return Math.abs((r.motherwave.high || 0) - (r.motherwave.low || 0));
}
function getZoneTray(r) {
  if (!r.trapZone || !r.motherwave) return "other";
  const last = r.lastCandle?.close;
  if (!last) return "other";
  const mw   = r.motherwave;
  const span = Math.abs(mw.fromPrice - mw.toPrice);
  const tol  = span * 0.05;
  if (Math.abs(last - fibPrice(mw, 0.618)) <= tol) return "hot618";
  if (Math.abs(last - fibPrice(mw, 0.382)) <= tol) return "near382";
  const tip      = fibPrice(mw, 0);
  const ret      = fibPrice(mw, 0.236);
  const trapHigh = Math.max(tip, ret);
  const trapLow  = Math.min(tip, ret);
  if (last >= trapLow && last <= trapHigh) return "trap";
  return "other";
}
function buildChartUrl(symbol, timeframe, mw) {
  if (!mw) {
    return `/charts?${new URLSearchParams({ symbol, resolution: String(timeframe) })}`;
  }
  const fromPrice = mw.fromPrice ?? mw.startPrice;
  const toPrice   = mw.toPrice   ?? mw.endPrice;
  const fromTime  = mw.fromTime  ?? mw.startTime;
  const toTime    = mw.toTime    ?? mw.endTime;
  const fromMs    = typeof fromTime === "string" ? new Date(fromTime).getTime() : fromTime;
  const toMs      = typeof toTime   === "string" ? new Date(toTime).getTime()   : toTime;
  const fibDrawing = encodeURIComponent(JSON.stringify({
    p1Price: toPrice, p1Time: Math.round(toMs / 1000),
    p2Price: fromPrice, p2Time: Math.round(fromMs / 1000),
  }));
  return `/charts?${new URLSearchParams({
    symbol, resolution: String(timeframe),
    waveFrom: String(fromMs), waveTo: String(toMs), fibDrawing,
  })}`;
}
function openChart(symbol, timeframe, mw) {
  window.open(buildChartUrl(symbol, timeframe, mw), "_blank");
}

// ─── TIMEFRAMES ───────────────────────────────────────────────────────────────
const TIMEFRAMES = [
  { value: 1,     label: "1m"  },
  { value: 3,     label: "3m"  },
  { value: 5,     label: "5m"  },
  { value: 15,    label: "15m" },
  { value: 60,    label: "1h"  },
  { value: 1440,  label: "1D"  },
  { value: 10080, label: "1W"  },
];

const STAGE_FILTERS = [
  { key: "all",     label: "All"         },
  { key: "signals", label: "Full Signal" },
  { key: "partial", label: "Watching"    },
  { key: "s1",      label: "S1"          },
  { key: "mw",      label: "Motherwave"  },
];

// ─── MWCard ───────────────────────────────────────────────────────────────────
function MWCard({ r, timeframe }) {
  const isBull = r.motherwave?.type === "bullish";
  const { cls, text } = stageLabel(r);
  const size = waveSize(r);
  return (
    <div
      className={`sp-mw-card ${isBull ? "sp-mw-bull" : "sp-mw-bear"}`}
      onClick={() => openChart(r.symbol, timeframe, r.motherwave)}
      title="Open chart with Fib drawn"
    >
      <div className="sp-mw-card-top">
        <div className="sp-mw-card-sym">
          <span className="sp-mw-card-ticker">{tickerOf(r.symbol)}</span>
          <span className="sp-mw-card-exch">{exchangeOf(r.symbol)}</span>
        </div>
        <span className={`sp-stage-pill ${cls}`}>{text}</span>
      </div>
      <div className="sp-mw-card-price">{fmt(r.lastCandle?.close)}</div>
      <div className="sp-mw-card-wave">
        <span className={`sp-wave-dir ${isBull ? "bull" : "bear"}`}>
          {isBull ? "▲ Bull" : "▼ Bear"}
        </span>
        <span className="sp-mw-card-size">Δ {fmt(size, 2)}</span>
      </div>
      {r.trapZone && (
        <div className="sp-mw-card-zone">
          Zone {fmt(r.trapZone.low)} – {fmt(r.trapZone.high)}
        </div>
      )}
    </div>
  );
}

// ─── ZoneTray ─────────────────────────────────────────────────────────────────
function ZoneTray({ label, subLabel, items, colorClass, timeframe }) {
  return (
    <div className={`sp-zone-tray ${colorClass}`}>
      <div className="sp-zone-tray-header">
        <div className="sp-zone-tray-title">{label}</div>
        <div className="sp-zone-tray-sub">{subLabel}</div>
        <div className="sp-zone-tray-count">{items.length}</div>
      </div>
      <div className="sp-zone-tray-body">
        {items.length === 0 ? (
          <div className="sp-zone-tray-empty">No stocks in this zone</div>
        ) : (
          items.map(r => (
            <div
              key={r.symbol}
              className="sp-zone-tray-item"
              onClick={() => openChart(r.symbol, timeframe, r.motherwave)}
              title="Open chart with Fib drawn"
            >
              <div className="sp-zone-tray-item-left">
                <span className="sp-zone-tray-sym">{tickerOf(r.symbol)}</span>
                <span className="sp-zone-tray-price">{fmt(r.lastCandle?.close)}</span>
              </div>
              <div className="sp-zone-tray-item-right">
                <span className={`sp-stage-pill ${stageLabel(r).cls}`}>{stageLabel(r).text}</span>
                {r.motherwave && (
                  <span className={`sp-wave-dir ${r.motherwave.type === "bullish" ? "bull" : "bear"}`}>
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

// ─── Strategy Picker (index page at /strategies) ───────────────────────────────
function StrategyPicker({ strategies, lastScan, status }) {
  const navigate  = useNavigate();
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="sp-picker-page">
      <div className="sp-picker-header">
        <button className="sp-back-btn" onClick={() => navigate("/scanner")}>← Scanner</button>
        <span className="sp-picker-title">Strategies</span>
        <div className="sp-picker-header-right">
          <span className="sp-picker-meta">
            {status?.symbolCount || 0} symbols · {strategies.length} strategies
            {lastScan ? ` · Last scan ${fmtTime(lastScan)}` : ""}
          </span>
          <button className="sp-theme-btn" onClick={toggleTheme}>
            {theme === "dark" ? "☀" : "🌙"}
          </button>
        </div>
      </div>

      <div className="sp-picker-body">
        <div className="sp-picker-hero">
          <div className="sp-picker-hero-icon">◈</div>
          <div className="sp-picker-hero-text">
            <h1 className="sp-picker-hero-title">Strategy Dashboard</h1>
            <p className="sp-picker-hero-sub">
              Select a strategy to view its full Motherwave analysis — uptrend &amp; downtrend columns,
              zone segregation, and Fibonacci levels.
            </p>
          </div>
        </div>

        {strategies.length === 0 ? (
          <div className="sp-picker-empty">
            <div className="sp-picker-empty-icon">〰</div>
            <div className="sp-picker-empty-title">No strategies loaded</div>
            <div className="sp-picker-empty-sub">Run a scan first from the Scanner page.</div>
            <button className="sp-picker-goto-scanner" onClick={() => navigate("/scanner")}>
              Go to Scanner →
            </button>
          </div>
        ) : (
          <div className="sp-picker-grid">
            {strategies.map((s, i) => (
              <button
                key={s.id}
                className="sp-picker-card"
                onClick={() => navigate(`/strategies/${s.id}`)}
                style={{ animationDelay: `${i * 80}ms` }}
              >
                <div className="sp-picker-card-icon">◈</div>
                <div className="sp-picker-card-body">
                  <div className="sp-picker-card-name">{s.name}</div>
                  <div className="sp-picker-card-desc">{s.description || "Pattern strategy"}</div>
                </div>
                <div className="sp-picker-card-arrow">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="12 5 19 12 12 19" />
                  </svg>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Strategy Dashboard (at /strategies/:id) ──────────────────────────────────
function StrategyDashboard({ strategyId, strategies }) {
  const navigate  = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const socketRef = useRef(null);

  const strategy  = strategies.find(s => s.id === strategyId);

  const [results,     setResults]     = useState([]);
  const [lastScan,    setLastScan]    = useState(null);
  const [mwFilter,    setMwFilter]    = useState("all");
  const [stageFilter, setStageFilter] = useState("all");
  const [search,      setSearch]      = useState("");
  const [activeView,  setActiveView]  = useState("dashboard"); // "dashboard" | "table"
  const [loading,     setLoading]     = useState(false);
  const [timeframe,   setTimeframe]   = useState(() => {
    try { const v = localStorage.getItem("tgg_scanner_tf"); return v ? JSON.parse(v) : 15; }
    catch { return 15; }
  });

  // ── Fetch results for this strategy ────────────────────────────────────────
  const fetchResults = useCallback(async () => {
    if (!strategyId) return;
    setLoading(true);
    try {
      const r = await fetch(`${BACKEND}/api/scanner/results/${strategyId}?per_page=500`)
        .then(r => r.json());
      setResults(r.results || []);
      // grab lastScan from status
      const s = await fetch(`${BACKEND}/api/scanner/status`).then(r => r.json());
      setLastScan(s.lastScanAt || null);
    } catch { }
    finally { setLoading(false); }
  }, [strategyId]);

  // ── Socket — listen for scan completion to auto-refresh ────────────────────
  // NOTE: When backend emits "strategy_results" per strategy, replace the
  // fetchResults() call below with direct state update from socket payload.
  // That's the full WebSocket upgrade — no component restructuring needed.
  useEffect(() => {
    fetchResults();
    const sock = io(BACKEND, { transports: ["websocket"] });
    socketRef.current = sock;

    sock.on("scanner_complete", () => {
      fetchResults();  // ← swap this for socket payload when backend emits per-strategy
    });
    sock.on("scanner_signal", () => {
      fetchResults();
    });

    return () => sock.disconnect();
  }, [fetchResults]);

  function handleTfChange(val) {
    setTimeframe(val);
    localStorage.setItem("tgg_scanner_tf", JSON.stringify(val));
  }

  // ── Derived ─────────────────────────────────────────────────────────────────
  const tfLabel = TIMEFRAMES.find(t => t.value === timeframe)?.label || `${timeframe}m`;

  const withMW      = useMemo(() =>
    results.filter(r => r.motherwave).sort((a, b) => waveSize(b) - waveSize(a)),
    [results]);
  const mwUptrend   = useMemo(() => withMW.filter(r => r.motherwave.type === "bullish"),  [withMW]);
  const mwDowntrend = useMemo(() => withMW.filter(r => r.motherwave.type === "bearish"),  [withMW]);

  const downWithZone  = useMemo(() => mwDowntrend.filter(r => r.trapZone), [mwDowntrend]);
  const trapZoneItems = useMemo(() => downWithZone.filter(r => getZoneTray(r) === "trap"),    [downWithZone]);
  const near382Items  = useMemo(() => downWithZone.filter(r => getZoneTray(r) === "near382"), [downWithZone]);
  const near618Items  = useMemo(() => downWithZone.filter(r => getZoneTray(r) === "hot618"),  [downWithZone]);

  const counts = useMemo(() => ({
    signals: results.filter(r => r.patternStage === "s3_complete").length,
    partial: results.filter(r => r.patternStage === "s2").length,
    s1:      results.filter(r => r.patternStage === "s1").length,
  }), [results]);

  const tableFiltered = useMemo(() => {
    return results.filter(r => {
      if (search && !r.symbol.toLowerCase().includes(search.toLowerCase())) return false;
      switch (stageFilter) {
        case "signals": return r.patternStage === "s3_complete";
        case "partial": return r.patternStage === "s2";
        case "s1":      return r.patternStage === "s1";
        case "mw":      return r.patternStage === "motherwave" || r.patternStage === "trapzone";
        default:        return true;
      }
    });
  }, [results, search, stageFilter]);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="sp-dash-page">

      {/* Header */}
      <div className="sp-dash-header">
        <button className="sp-back-btn" onClick={() => navigate("/strategies")}>← Strategies</button>

        <div className="sp-dash-header-title-group">
          <span className="sp-dash-header-icon">◈</span>
          <span className="sp-dash-header-name">{strategy?.name || strategyId}</span>
        </div>

        {/* TF */}
        <div className="sp-tf-group">
          {TIMEFRAMES.map(tf => (
            <button
              key={tf.value}
              className={`sp-tf-btn ${timeframe === tf.value ? "active" : ""}`}
              onClick={() => handleTfChange(tf.value)}
            >
              {tf.label}
            </button>
          ))}
        </div>

        <div className="sp-dash-header-spacer" />

        {/* Search */}
        <div className="sp-search-wrap">
          <span className="sp-search-icon">⌕</span>
          <input
            className="sp-search-input"
            placeholder="Search symbol…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* View toggle */}
        <div className="sp-view-toggle">
          <button
            className={`sp-view-btn ${activeView === "dashboard" ? "active" : ""}`}
            onClick={() => setActiveView("dashboard")}
            title="Motherwave Dashboard"
          >
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none">
              <rect x="1" y="1" width="6" height="6" rx="1" fill="currentColor" opacity="0.9" />
              <rect x="9" y="1" width="6" height="6" rx="1" fill="currentColor" opacity="0.9" />
              <rect x="1" y="9" width="6" height="6" rx="1" fill="currentColor" opacity="0.9" />
              <rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor" opacity="0.9" />
            </svg>
          </button>
          <button
            className={`sp-view-btn ${activeView === "table" ? "active" : ""}`}
            onClick={() => setActiveView("table")}
            title="Table View"
          >
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none">
              <rect x="1" y="1"  width="14" height="2.5" rx="0.75" fill="currentColor" opacity="0.9" />
              <rect x="1" y="5"  width="14" height="2.5" rx="0.75" fill="currentColor" opacity="0.5" />
              <rect x="1" y="9"  width="14" height="2.5" rx="0.75" fill="currentColor" opacity="0.5" />
              <rect x="1" y="13" width="14" height="2.5" rx="0.75" fill="currentColor" opacity="0.5" />
            </svg>
          </button>
        </div>

        <button className="sp-theme-btn" onClick={toggleTheme}>
          {theme === "dark" ? "☀" : "🌙"}
        </button>

        {loading && <div className="sp-loading-dot" title="Fetching…" />}
      </div>

      {/* Stats bar */}
      <div className="sp-stats-bar">
        <div className="sp-stat"><span className="sp-stat-label">Scanned</span>   <span className="sp-stat-val accent">{results.length}</span></div>
        <div className="sp-stat"><span className="sp-stat-label">Uptrend</span>   <span className="sp-stat-val green">{mwUptrend.length}</span></div>
        <div className="sp-stat"><span className="sp-stat-label">Downtrend</span> <span className="sp-stat-val red">{mwDowntrend.length}</span></div>
        <div className="sp-stat"><span className="sp-stat-label">Full Signal</span><span className="sp-stat-val green">{counts.signals}</span></div>
        <div className="sp-stat"><span className="sp-stat-label">Watching</span>  <span className="sp-stat-val orange">{counts.partial}</span></div>
        <div className="sp-stat"><span className="sp-stat-label">S1 Formed</span> <span className="sp-stat-val">{counts.s1}</span></div>
        <div className="sp-stat"><span className="sp-stat-label">Resolution</span><span className="sp-stat-val accent">{tfLabel}</span></div>
        <div className="sp-stat"><span className="sp-stat-label">Last Scan</span> <span className="sp-stat-val" style={{ fontSize: 11 }}>{lastScan ? fmtTime(lastScan) : "—"}</span></div>
      </div>

      {/* Strategy description */}
      {strategy?.description && (
        <div className="sp-strategy-desc">{strategy.description}</div>
      )}

      {/* Body */}
      <div className="sp-dash-body" key={activeView}>

        {/* ── DASHBOARD VIEW ── */}
        {activeView === "dashboard" && (
          <div className="sp-dash-section">

            {/* Direction filter */}
            <div className="sp-dash-section-header">
              <div className="sp-dash-section-left">
                <span className="sp-dash-section-title">Motherwave Dashboard</span>
                <span className="sp-dash-section-sub">
                  {strategy?.name} · {tfLabel} · sorted by wave size ↓
                </span>
              </div>
              <div className="sp-mw-dir-filter">
                {[
                  { key: "all",  label: `All (${withMW.length})`          },
                  { key: "bull", label: `▲ Bull (${mwUptrend.length})`    },
                  { key: "bear", label: `▼ Bear (${mwDowntrend.length})`  },
                ].map(f => (
                  <button
                    key={f.key}
                    className={`sp-mw-dir-btn ${mwFilter === f.key ? "active" : ""}`}
                    onClick={() => setMwFilter(f.key)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {withMW.length === 0 ? (
              <div className="sp-empty">
                <div className="sp-empty-icon">〰</div>
                <div className="sp-empty-title">No motherwave data yet</div>
                <div className="sp-empty-sub">Run a scan from the Scanner page to populate.</div>
              </div>
            ) : (
              <>
                {/* Trend columns */}
                <div className="sp-trend-columns">
                  <div className="sp-trend-col sp-uptrend-col">
                    <div className="sp-trend-col-header">
                      <span className="sp-trend-col-arrow">▲</span>
                      <span className="sp-trend-col-title">UPTREND</span>
                      <span className="sp-trend-col-count">
                        {mwFilter === "bear" ? 0 : mwUptrend.length} stocks
                      </span>
                    </div>
                    <div className="sp-trend-col-body">
                      {(mwFilter === "bear" ? [] : mwUptrend).length === 0 ? (
                        <div className="sp-trend-col-empty">No uptrend stocks</div>
                      ) : (
                        (mwFilter === "bear" ? [] : mwUptrend).map(r =>
                          <MWCard key={r.symbol} r={r} timeframe={timeframe} />
                        )
                      )}
                    </div>
                  </div>

                  <div className="sp-trend-col sp-downtrend-col">
                    <div className="sp-trend-col-header">
                      <span className="sp-trend-col-arrow">▼</span>
                      <span className="sp-trend-col-title">DOWNTREND</span>
                      <span className="sp-trend-col-count">
                        {mwFilter === "bull" ? 0 : mwDowntrend.length} stocks
                      </span>
                    </div>
                    <div className="sp-trend-col-body">
                      {(mwFilter === "bull" ? [] : mwDowntrend).length === 0 ? (
                        <div className="sp-trend-col-empty">No downtrend stocks</div>
                      ) : (
                        (mwFilter === "bull" ? [] : mwDowntrend).map(r =>
                          <MWCard key={r.symbol} r={r} timeframe={timeframe} />
                        )
                      )}
                    </div>
                  </div>
                </div>

                {/* Zone segregation */}
                <div className="sp-zone-section">
                  <div className="sp-zone-section-title">
                    Zone Segregation
                    <span className="sp-zone-section-sub">
                      Downtrend stocks by Fibonacci zone
                    </span>
                  </div>
                  <div className="sp-zone-trays">
                    <ZoneTray
                      label="TRAP ZONE"
                      subLabel="fp(0) – fp(0.236) — at wave tip"
                      items={trapZoneItems}
                      colorClass="sp-tray-trap"
                      timeframe={timeframe}
                    />
                    <ZoneTray
                      label="NEAR 0.382"
                      subLabel="Within 5% of 0.382 Fib level"
                      items={near382Items}
                      colorClass="sp-tray-382"
                      timeframe={timeframe}
                    />
                    <ZoneTray
                      label="NEAR 0.618 (HOT)"
                      subLabel="Within 5% of 0.618 Fib level"
                      items={near618Items}
                      colorClass="sp-tray-618"
                      timeframe={timeframe}
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── TABLE VIEW ── */}
        {activeView === "table" && (
          <div className="sp-dash-section">
            <div className="sp-table-controls">
              {STAGE_FILTERS.map(f => (
                <button
                  key={f.key}
                  className={`sp-filter-btn ${stageFilter === f.key ? "active" : ""}`}
                  onClick={() => setStageFilter(f.key)}
                >
                  {f.label}
                  {f.key === "signals" && counts.signals > 0 &&
                    <span className="sp-count-badge green">{counts.signals}</span>}
                  {f.key === "partial" && counts.partial > 0 &&
                    <span className="sp-count-badge orange">{counts.partial}</span>}
                  {f.key === "s1" && counts.s1 > 0 &&
                    <span className="sp-count-badge">{counts.s1}</span>}
                </button>
              ))}
              <div style={{ flex: 1 }} />
              <span className="sp-last-scan-label">
                {lastScan ? `Last: ${fmtTime(lastScan)}` : "Not scanned yet"}
              </span>
              <span className="sp-res-badge">{tfLabel}</span>
            </div>

            {tableFiltered.length === 0 ? (
              <div className="sp-empty">
                <div className="sp-empty-icon">🔍</div>
                <div className="sp-empty-title">
                  {results.length === 0 ? "No scan results yet" : "No matches"}
                </div>
                <div className="sp-empty-sub">
                  {results.length === 0
                    ? "Run a scan from the Scanner page."
                    : "Try a different filter or search term."}
                </div>
              </div>
            ) : (
              <div className="sp-table-wrap">
                <table className="sp-table">
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
                    {tableFiltered.map(r => {
                      const { cls, text } = stageLabel(r);
                      return (
                        <tr
                          key={r.symbol}
                          className="sp-table-row"
                          onClick={() => openChart(r.symbol, timeframe, r.motherwave)}
                          title="Open chart with Fib drawn"
                        >
                          <td>
                            <div className="sp-sym-cell">{tickerOf(r.symbol)}</div>
                            <div className="sp-sym-exch">{exchangeOf(r.symbol)}</div>
                          </td>
                          <td><span className={`sp-stage-pill ${cls}`}>{text}</span></td>
                          <td>
                            {r.motherwave
                              ? <span className={`sp-wave-dir ${r.motherwave.type === "bullish" ? "bull" : "bear"}`}>
                                  {r.motherwave.type === "bullish" ? "▲ Bull" : "▼ Bear"}
                                </span>
                              : <span style={{ color: "var(--text3)" }}>—</span>}
                          </td>
                          <td className="sp-price-cell">{fmt(r.trapZone?.high)}</td>
                          <td className="sp-price-cell">{fmt(r.trapZone?.low)}</td>
                          <td className={`sp-price-cell ${r.s1 ? "red" : ""}`}>{fmt(r.s1?.close)}</td>
                          <td className={`sp-price-cell ${r.s2 ? "green" : ""}`}>{fmt(r.s2?.close)}</td>
                          <td className={`sp-price-cell ${r.s3 ? "red" : ""}`}>{fmt(r.s3?.close)}</td>
                          <td className="sp-price-cell">{fmt(r.lastCandle?.close)}</td>
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

      </div>
    </div>
  );
}

// ─── Root — loads strategies, decides which sub-page to show ─────────────────
export default function StrategiesPage() {
  const { id }          = useParams();           // undefined on /strategies
  const [strategies, setStrategies] = useState([]);
  const [lastScan,   setLastScan]   = useState(null);
  const [status,     setStatus]     = useState(null);

  useEffect(() => {
    fetch(`${BACKEND}/api/scanner/status`)
      .then(r => r.json())
      .then(s => {
        setStatus(s);
        setLastScan(s.lastScanAt || null);
        setStrategies(s.strategies || []);
      })
      .catch(() => {});
  }, [id]);

  if (id) {
    return (
      <StrategyDashboard
        strategyId={id}
        strategies={strategies}
      />
    );
  }
  return (
    <StrategyPicker
      strategies={strategies}
      lastScan={lastScan}
      status={status}
    />
  );
}
