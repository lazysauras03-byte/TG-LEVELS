// ChartsReportPage.js
// Wave Report page — fetches real candle data from the backend for the selected
// timeframe, runs the exact same wave algorithm as the chart, and displays the
// resulting wave table with proper Dow Theory labels (HH / LH / HL / LL).

import React, { useState, useMemo, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { updateWavesIndicatorPure } from "../indicators/WavesIndicatorPure";
import "./ChartsReportPage.css";

const BACKEND = process.env.REACT_APP_BACKEND_URL || "http://localhost:3299";

// ── Timeframes — identical to ChartsPage / StatusBar ─────────────────────────
const TIMEFRAMES = [
  { label: "1m", value: 1 },
  { label: "3m", value: 3 },
  { label: "5m", value: 5 },
  { label: "15m", value: 15 },
  { label: "1h", value: 60 },
  { label: "1D", value: 1440 },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
const numFmt = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function fmt(n) { return n == null ? "—" : numFmt.format(Number(n)); }

function toISTStr(tsMs) {
  if (!tsMs) return "—";
  const ist = new Date(tsMs + 5.5 * 60 * 60 * 1000);
  const dd = String(ist.getUTCDate()).padStart(2, "0");
  const mon = ist.toLocaleString("en", { month: "short", timeZone: "UTC" });
  const hh = String(ist.getUTCHours()).padStart(2, "0");
  const mm = String(ist.getUTCMinutes()).padStart(2, "0");
  return `${dd}/${mon} ${hh}:${mm}`;
}

function toISTDate(tsMs) {
  const ist = new Date(tsMs + 5.5 * 60 * 60 * 1000);
  return `${String(ist.getUTCDate()).padStart(2, "0")}/${ist.toLocaleString("en", { month: "short", timeZone: "UTC" })}`;
}

// ── Convert segments from WavesIndicatorPure into table rows ─────────────────
function buildTableRows(segments) {
  return segments.map((seg, i) => {
    const isBull = seg.toSide === "high";
    const delta = Math.abs(seg.toPrice - seg.fromPrice);
    const fromLbl = seg.prevWaveType || "—";
    const toLbl = seg.currWaveType || "—";
    const label = `${fromLbl}\u2192${toLbl}`;

    const highTime = isBull ? seg.toTime : seg.fromTime;
    const highPrice = isBull ? seg.toPrice : seg.fromPrice;
    const lowTime = isBull ? seg.fromTime : seg.toTime;
    const lowPrice = isBull ? seg.fromPrice : seg.toPrice;
    const date = toISTDate(lowTime);

    return {
      id: `seg-${i}`,
      n: i + 1,
      date,
      dir: isBull ? "bull" : "bear",
      label,
      highTime, highPrice,
      lowTime, lowPrice,
      delta: +delta.toFixed(2),
      waveNum: seg.waveNum,
    };
  });
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ChartsReportPage() {
  const navigate = useNavigate();

  const [timeframe, setTimeframe] = useState(() => {
    try { const v = localStorage.getItem("tgg_resolution"); return v ? JSON.parse(v) : 15; }
    catch { return 15; }
  });

  const [symbol] = useState(() => {
    try { const v = localStorage.getItem("tgg_symbol"); return v ? JSON.parse(v) : "NSE:NIFTY50-INDEX"; }
    catch { return "NSE:NIFTY50-INDEX"; }
  });

  const [candles, setCandles] = useState([]);
  const [emaHighs, setEmaHighs] = useState([]);
  const [emaLows, setEmaLows] = useState([]);
  const [loadState, setLoadState] = useState("idle");
  const [errMsg, setErrMsg] = useState("");

  const [fDate, setFDate] = useState("all");
  const [fDir, setFDir] = useState("all");
  const [fSize, setFSize] = useState("all");
  const [fQ, setFQ] = useState("");

  const [sortCol, setSortCol] = useState("delta");
  const [sortDir, setSortDir] = useState("asc");

  // ── Fetch ───────────────────────────────────────────────────────────────────
  const fetchData = useCallback(async (sym, res) => {
    setLoadState("loading");
    setErrMsg("");
    try {
      // Try POST refresh first (same endpoint ChartsPage uses)
      const url = `${BACKEND}/api/chart/refresh?symbol=${encodeURIComponent(sym)}&resolution=${res}`;
      const r = await fetch(url, { method: "POST" });
      const data = r.ok ? await r.json() : null;

      if (data && data.candles && data.candles.length) {
        setCandles(data.candles);
        setEmaHighs(data.emaHighs || []);
        setEmaLows(data.emaLows || []);
        setLoadState("done");
        return;
      }

      // Fallback: GET current cached data
      const r2 = await fetch(`${BACKEND}/api/chart`);
      const data2 = r2.ok ? await r2.json() : null;
      if (data2 && data2.candles && data2.candles.length) {
        setCandles(data2.candles);
        setEmaHighs(data2.emaHighs || []);
        setEmaLows(data2.emaLows || []);
        setLoadState("done");
      } else {
        setLoadState("error");
        setErrMsg("No candle data from backend. Run npm run generate, then Refresh.");
      }
    } catch (e) {
      setLoadState("error");
      setErrMsg(e.message || "Network error connecting to backend.");
    }
  }, []);

  useEffect(() => { fetchData(symbol, timeframe); }, [symbol, timeframe, fetchData]);

  // ── Wave calculation ────────────────────────────────────────────────────────
  const { allWaves, maxDelta, allDates } = useMemo(() => {
    if (!candles.length) return { allWaves: [], maxDelta: 1, allDates: [] };
    const { segments } = updateWavesIndicatorPure(candles, emaHighs, emaLows);
    const rows = buildTableRows(segments);
    const md = rows.reduce((acc, w) => Math.max(acc, w.delta), 1);
    const dates = [...new Set(rows.map((w) => w.date))].sort();
    return { allWaves: rows, maxDelta: md, allDates: dates };
  }, [candles, emaHighs, emaLows]);

  // ── Stats ───────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    if (!allWaves.length) return { total: 0, avg: "0.0", maxBull: "0.00", maxBear: "0.00" };
    const deltas = allWaves.map((w) => w.delta);
    const bullWaves = allWaves.filter((w) => w.dir === "bull");
    const bearWaves = allWaves.filter((w) => w.dir === "bear");
    return {
      total: allWaves.length,
      avg: (deltas.reduce((a, b) => a + b, 0) / deltas.length).toFixed(1),
      maxBull: bullWaves.length ? Math.max(...bullWaves.map((w) => w.delta)).toFixed(2) : "0.00",
      maxBear: bearWaves.length ? Math.max(...bearWaves.map((w) => w.delta)).toFixed(2) : "0.00",
    };
  }, [allWaves]);

  // ── Sort ────────────────────────────────────────────────────────────────────
  function handleColSort(col) {
    if (sortCol === col) {
      if (sortDir === "asc") setSortDir("desc");
      else if (sortDir === "desc") { setSortDir(null); setSortCol(null); }
      else { setSortDir("asc"); setSortCol(col); }
    } else { setSortCol(col); setSortDir("asc"); }
  }
  function clearSort() { setSortCol(null); setSortDir(null); }

  // ── Filter + sort ───────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let data = allWaves.filter((w) => {
      if (fDate !== "all" && w.date !== fDate) return false;
      if (fDir === "bull" && w.dir !== "bull") return false;
      if (fDir === "bear" && w.dir !== "bear") return false;
      if (fSize === "small" && w.delta >= 30) return false;
      if (fSize === "medium" && (w.delta < 30 || w.delta > 80)) return false;
      if (fSize === "large" && w.delta <= 80) return false;
      if (fQ && !String(w.n).includes(fQ.trim())) return false;
      return true;
    });
    if (sortCol && sortDir) {
      data = [...data].sort((a, b) => {
        const av = sortCol === "delta" ? a.delta : sortCol === "highTime" ? a.highTime : a.lowTime;
        const bv = sortCol === "delta" ? b.delta : sortCol === "highTime" ? b.highTime : b.lowTime;
        if (sortDir === "asc") return typeof av === "number" ? av - bv : av > bv ? 1 : -1;
        return typeof av === "number" ? bv - av : bv > av ? 1 : -1;
      });
    }
    return data;
  }, [allWaves, fDate, fDir, fSize, fQ, sortCol, sortDir]);

  function sortArrow(col) {
    if (sortCol !== col || !sortDir) return <span className="cr-sort-arrow inactive">↕</span>;
    return <span className="cr-sort-arrow active">{sortDir === "asc" ? "↑" : "↓"}</span>;
  }

  const sortLabel = !sortCol ? "Sort by Δ" : sortDir === "asc" ? "Δ Ascending" : "Δ Descending";
  const isSortedByDelta = sortCol === "delta" && sortDir;
  const tfLabel = TIMEFRAMES.find((t) => t.value === timeframe)?.label || String(timeframe);
  let lastDate = "";

  return (
    <div className="cr-page">

      {/* ── Topbar ─────────────────────────────────────────────────────────── */}
      <div className="cr-topbar">
        <button className="cr-back-btn" onClick={() => navigate("/charts")} title="Back to Charts">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
        </button>

        <div className="cr-logo">
          <span className="cr-logo-t">TG</span>
          <span className="cr-logo-sub">DASHBOARD</span>
        </div>

        <div style={{ flex: 1 }} />

        {/* Timeframe pills — right side */}
        <div className="cr-tf-group">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.value}
              className={`cr-tf-btn ${timeframe === tf.value ? "active" : ""}`}
              onClick={() => setTimeframe(tf.value)}
            >
              {tf.label}
            </button>
          ))}
        </div>

        <button
          className="cr-reload-btn"
          onClick={() => fetchData(symbol, timeframe)}
          disabled={loadState === "loading"}
          title="Reload"
        >
          <span style={{ display: "inline-block", animation: loadState === "loading" ? "cr-spin 0.8s linear infinite" : "none" }}>↻</span>
        </button>
      </div>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div className="cr-body">

        {loadState === "loading" && (
          <div className="cr-state-overlay">
            <div className="cr-spinner" />
            <span>Loading {tfLabel} wave data…</span>
          </div>
        )}

        {loadState === "error" && (
          <div className="cr-state-overlay cr-state-error">
            <span>⚠ {errMsg}</span>
            <button className="cr-reload-btn" style={{ marginTop: 12 }} onClick={() => fetchData(symbol, timeframe)}>Retry</button>
          </div>
        )}

        {(loadState === "done" || (loadState === "idle" && allWaves.length > 0)) && (
          <>
            {/* Stats */}
            <div className="cr-stat-row">
              <div className="cr-stat">
                <div className="cr-stat-lbl">Total Waves</div>
                <div className="cr-stat-val">{stats.total}</div>
              </div>
              <div className="cr-stat">
                <div className="cr-stat-lbl">Avg Wave Δ</div>
                <div className="cr-stat-val">{stats.avg}</div>
              </div>
              <div className="cr-stat">
                <div className="cr-stat-lbl">Largest Bullish Δ</div>
                <div className="cr-stat-val cr-bull">+{stats.maxBull}</div>
              </div>
              <div className="cr-stat">
                <div className="cr-stat-lbl">Largest Bearish Δ</div>
                <div className="cr-stat-val cr-bear">−{stats.maxBear}</div>
              </div>
            </div>

            {/* Controls */}
            <div className="cr-controls">
              <div className="cr-select-wrap">
                <select value={fDate} onChange={(e) => setFDate(e.target.value)} className="cr-select">
                  <option value="all">All dates</option>
                  {allDates.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>

              <div className="cr-select-wrap">
                <select value={fDir} onChange={(e) => setFDir(e.target.value)} className="cr-select">
                  <option value="all">All directions</option>
                  <option value="bull">Bullish only ▲</option>
                  <option value="bear">Bearish only ▼</option>
                </select>
              </div>

              <div className="cr-select-wrap">
                <select value={fSize} onChange={(e) => setFSize(e.target.value)} className="cr-select">
                  <option value="all">All sizes</option>
                  <option value="small">Small (&lt; 30)</option>
                  <option value="medium">Medium (30–80)</option>
                  <option value="large">Large (&gt; 80)</option>
                </select>
              </div>

              <div className="cr-sort-group">
                <button
                  className={`cr-sort-btn ${sortCol === "delta" && sortDir ? "active" : ""}`}
                  onClick={() => handleColSort("delta")}
                >
                  <span>{sortLabel}</span>
                  <span className="cr-sort-icon">{sortCol === "delta" && sortDir ? (sortDir === "asc" ? "↑" : "↓") : "↕"}</span>
                </button>
                {sortCol && sortDir && (
                  <button className="cr-clear-sort" onClick={clearSort} title="Clear sort">✕</button>
                )}
              </div>

              <div className="cr-search-wrap">
                <input
                  type="text" value={fQ}
                  onChange={(e) => setFQ(e.target.value)}
                  placeholder="Wave #..." className="cr-search"
                />
                {fQ && <button className="cr-search-clear" onClick={() => setFQ("")} title="Clear">✕</button>}
              </div>

              <span className="cr-row-count">{filtered.length} rows shown</span>
            </div>

            {/* Table */}
            <div className="cr-table-wrap">
              <table className="cr-table">
                <thead>
                  <tr>
                    <th className="cr-th-num">#</th>
                    <th className="cr-th-wave">Wave</th>
                    <th className="cr-th-dir">Direction</th>
                    <th
                      className={`cr-th-sortable ${sortCol === "highTime" ? "cr-th-sorted" : ""}`}
                      onClick={() => handleColSort("highTime")}
                    >
                      High Time / Price {sortArrow("highTime")}
                    </th>
                    <th
                      className={`cr-th-sortable ${sortCol === "lowTime" ? "cr-th-sorted" : ""}`}
                      onClick={() => handleColSort("lowTime")}
                    >
                      Low Time / Price {sortArrow("lowTime")}
                    </th>
                    <th
                      className={`cr-th-sortable ${sortCol === "delta" ? "cr-th-sorted" : ""}`}
                      onClick={() => handleColSort("delta")}
                    >
                      Wave Δ (abs) {sortArrow("delta")}
                    </th>
                    <th className="cr-th">Strength Bar</th>
                    <th className="cr-th">Size</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="cr-no-data">
                        {allWaves.length === 0
                          ? "No waves detected — ensure backend has data for this timeframe."
                          : "No waves match the current filters."}
                      </td>
                    </tr>
                  ) : (
                    filtered.map((w, idx) => {
                      const showDateSep = !isSortedByDelta && w.date !== lastDate;
                      if (showDateSep) lastDate = w.date;
                      const barW = Math.max(4, Math.round((w.delta / maxDelta) * 100));
                      const isBull = w.dir === "bull";

                      return (
                        <React.Fragment key={w.id}>
                          {showDateSep && (
                            <tr className="cr-date-sep">
                              <td colSpan={8}>— {w.date} —</td>
                            </tr>
                          )}
                          <tr className="cr-row">
                            <td>
                              {isSortedByDelta
                                ? <RankPill rank={idx + 1} />
                                : <span className="cr-w-num">{idx + 1}</span>}
                            </td>

                            <td>
                              <span className="cr-w-num">{w.n}</span>
                              <br />
                              <span className="cr-w-label">{w.label}</span>
                            </td>

                            <td>
                              {isBull
                                ? <span className="cr-badge cr-badge-bull">▲ Bullish</span>
                                : <span className="cr-badge cr-badge-bear">▼ Bearish</span>}
                            </td>

                            <td>
                              <span className="cr-time">{toISTStr(w.highTime)}</span>
                              <span className="cr-price">{fmt(w.highPrice)}</span>
                            </td>

                            <td>
                              <span className="cr-time">{toISTStr(w.lowTime)}</span>
                              <span className="cr-price">{fmt(w.lowPrice)}</span>
                            </td>

                            <td>
                              <span className={`cr-delta ${isBull ? "cr-bull" : "cr-bear"}`}>
                                {isBull ? "+" : "−"}{w.delta.toFixed(2)}
                              </span>
                            </td>

                            <td>
                              <div className="cr-bar-wrap">
                                <div className="cr-bar-bg">
                                  <div
                                    className="cr-bar-fill"
                                    style={{ width: `${barW}%`, background: isBull ? "#639922" : "#E24B4A" }}
                                  />
                                </div>
                                <span className="cr-bar-pct">{barW}%</span>
                              </div>
                            </td>

                            <td><SizeBadge delta={w.delta} /></td>
                          </tr>
                        </React.Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function RankPill({ rank }) {
  const cls = rank === 1 ? "cr-rank cr-rank-1"
    : rank === 2 ? "cr-rank cr-rank-2"
      : rank === 3 ? "cr-rank cr-rank-3"
        : "cr-rank";
  return <span className={cls}>{rank}</span>;
}

function SizeBadge({ delta }) {
  if (delta < 30) return <span className="cr-badge cr-badge-sm">Small</span>;
  if (delta <= 80) return <span className="cr-badge cr-badge-med">Medium</span>;
  return <span className="cr-badge cr-badge-lg-bull">Large</span>;
}