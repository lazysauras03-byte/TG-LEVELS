// ScannerPage.js
import React, { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { io } from "socket.io-client";
import { BACKEND } from "../config";
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
function stageLabel(r) {
  if (r.error) return { cls: "error", text: "Error" };
  if (r.patternStage === "s3_complete") return { cls: "s3", text: "S3 ✓" };
  if (r.patternStage === "s2") return { cls: "s2", text: "S2 →" };
  if (r.patternStage === "s1") return { cls: "s1", text: "S1" };
  if (r.patternStage === "trapzone") return { cls: "mw", text: "TrapZone" };
  if (r.patternStage === "motherwave") return { cls: "mw", text: "Motherwave" };
  return { cls: "none", text: "—" };
}

const STAGE_FILTERS = [
  { key: "all", label: "All" },
  { key: "signals", label: "Full Signal" },
  { key: "partial", label: "Watching" },
  { key: "s1", label: "S1" },
  { key: "mw", label: "Motherwave" },
];

// ─── Component ────────────────────────────────────────────────────────────────
export default function ScannerPage() {
  const navigate = useNavigate();
  const socketRef = useRef(null);

  const [strategies, setStrategies] = useState([]);
  const [activeStrategy, setActiveStrategy] = useState(null); // strategyId
  const [results, setResults] = useState([]);
  const [status, setStatus] = useState(null);
  const [stageFilter, setStageFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [progress, setProgress] = useState(null);
  const [loading, setLoading] = useState(false);
  const [lastScan, setLastScan] = useState(null);

  // ── Fetch ─────────────────────────────────────────────────────────────────
  const fetchStatus = useCallback(async () => {
    try {
      const s = await fetch(`${BACKEND}/api/scanner/status`).then(r => r.json());
      setStatus(s);
      setLastScan(s.lastScanAt);
      // populate strategy list from status on first load
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

  // Refetch results whenever active strategy changes or scan completes
  useEffect(() => {
    if (activeStrategy) fetchResults(activeStrategy);
  }, [activeStrategy, lastScan, fetchResults]);

  // ── Trigger ───────────────────────────────────────────────────────────────
  async function handleTrigger() {
    if (loading || isRunning) return;
    setLoading(true);
    try {
      await fetch(`${BACKEND}/api/scanner/trigger`, { method: "POST" });
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

  const isRunning = status?.running || !!progress;
  const pct = progress ? Math.round((progress.done / Math.max(1, progress.total)) * 100) : 0;

  const activeStrat = strategies.find(s => s.id === activeStrategy);

  return (
    <div className="scanner-page">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="scanner-header">
        <button className="scanner-header-back" onClick={() => navigate("/")}>← Back</button>
        <span className="scanner-header-title">Pattern Scanner</span>
        <div className="scanner-header-spacer" />
        <div className="scanner-header-status">
          <div className={`scanner-status-dot ${isRunning ? "running" : "idle"}`} />
          {isRunning
            ? `Scanning… ${progress?.done || 0} / ${progress?.total || status?.symbolCount || "?"}`
            : `${status?.symbolCount || 0} symbols · ${strategies.length} strategies`}
        </div>
        {isRunning && (
          <button className="scanner-stop-btn" onClick={handleStop}>
            ⏹ Stop
          </button>
        )}
        <button
          className="scanner-trigger-btn"
          onClick={handleTrigger}
          disabled={isRunning || loading}
        >
          {isRunning ? "Running…" : "▶ Scan Now"}
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
        <input
          className="scanner-search"
          placeholder="Search symbol…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <span className="scanner-last-scan">
          {lastScan ? `Last: ${fmtTime(lastScan)}` : "Not scanned yet"}
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
            <div className="scanner-summary-card-label">Resolution</div>
            <div className="scanner-summary-card-value accent">{status?.resolution || "—"}m</div>
          </div>
          <div className="scanner-summary-card">
            <div className="scanner-summary-card-label">Last Duration</div>
            <div className="scanner-summary-card-value" style={{ fontSize: 14 }}>
              {status?.lastScanDurationMs ? `${(status.lastScanDurationMs / 1000).toFixed(0)}s` : "—"}
            </div>
          </div>
        </div>

        {/* Results table */}
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
                        <div className="symbol-ticker">{r.symbol.split(":")[0]}</div>
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