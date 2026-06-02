// ReportsPage.js
// Wave Report page — fetches real candle data from the backend for the selected
// timeframe, runs the exact same wave algorithm as the chart, and displays the
// resulting wave table with proper Dow Theory labels (HH / LH / HL / LL).

import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { updateWavesIndicatorPure } from "../indicators/WavesIndicator";
import { useTheme } from "../App";
import SYMBOLS from "../symbols.json";
import "./ReportsPage.css";

import { BACKEND } from "../config";

// ── Timeframes ────────────────────────────────────────────────────────────────
const TIMEFRAMES = [
  { label: "1m", value: 1 },
  { label: "3m", value: 3 },
  { label: "5m", value: 5 },
  { label: "15m", value: 15 },
  { label: "1h", value: 60 },
  { label: "1D", value: 1440 },
  { label: "1W", value: 10080 },
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

// ── Build table rows ──────────────────────────────────────────────────────────
// col1 = wave START (fromTime/fromPrice), col2 = wave END (toTime/toPrice)
function buildTableRows(segments) {
  return segments.map((seg, i) => {
    const isBull = seg.toSide === "high";
    const delta = Math.abs(seg.toPrice - seg.fromPrice);
    const label = `${seg.prevWaveType || "—"}\u2192${seg.currWaveType || "—"}`;
    const date = toISTDate(seg.fromTime);

    return {
      id: `seg-${i}`,
      n: i + 1,
      date,
      dir: isBull ? "bull" : "bear",
      label,
      col1Time: seg.fromTime,
      col1Price: seg.fromPrice,
      col2Time: seg.toTime,
      col2Price: seg.toPrice,
      delta: +delta.toFixed(2),
      waveNum: seg.waveNum,
    };
  });
}

// ── Symbol search ─────────────────────────────────────────────────────────────
function SymbolSearch({ symbol, onSelect }) {
  const [query, setQuery] = useState(symbol);
  const [suggestions, setSuggestions] = useState([]);
  const [showDrop, setShowDrop] = useState(false);
  const inputRef = useRef(null);
  const dropRef = useRef(null);

  useEffect(() => { setQuery(symbol); }, [symbol]);

  function handleChange(e) {
    const val = e.target.value;
    setQuery(val);
    if (!val) { setSuggestions([]); setShowDrop(false); return; }
    const q = val.toLowerCase();
    const hits = SYMBOLS
      .filter((s) => {
        const nameLower = s.name.toLowerCase();
        const colonIdx = s.symbol.indexOf(":");
        const ticker = (colonIdx >= 0 ? s.symbol.slice(colonIdx + 1) : s.symbol).toLowerCase();
        return nameLower.startsWith(q) || ticker.startsWith(q);
      })
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 10);
    setSuggestions(hits);
    setShowDrop(hits.length > 0);
  }

  function handleSelect(sym) {
    setQuery(sym.symbol);
    setSuggestions([]);
    setShowDrop(false);
    onSelect(sym.symbol);
  }

  function handleKeyDown(e) {
    if (e.key === "Enter") { setShowDrop(false); onSelect(query); }
    if (e.key === "Escape") setShowDrop(false);
  }

  useEffect(() => {
    function handler(e) {
      if (
        dropRef.current && !dropRef.current.contains(e.target) &&
        inputRef.current && !inputRef.current.contains(e.target)
      ) setShowDrop(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="cr-sym-wrap">
      <input
        ref={inputRef}
        value={query}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => query && setShowDrop(suggestions.length > 0)}
        className="cr-sym-input"
        placeholder="Search symbol…"
        autoComplete="off"
        spellCheck={false}
      />
      {showDrop && (
        <div ref={dropRef} className="cr-sym-dropdown">
          {suggestions.map((s, i) => (
            <div key={i} className="cr-sym-item" onMouseDown={() => handleSelect(s)}>
              <span className="cr-sym-ticker">{s.symbol}</span>
              <span className="cr-sym-name">
                {s.name.length > 34 ? s.name.slice(0, 34) + "…" : s.name}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Mother Wave Card ──────────────────────────────────────────────────────────
function MotherWaveSection({ motherWave, onWaveClick }) {
  if (!motherWave) return null;

  const { wave, fibLevels, invalidation } = motherWave;
  const isBull = wave.dir === "bull";

  // BULL display: -0.618 (top/highest) → 0 → 0.236...1.0 (bottom/lowest)
  // BEAR display: 1.0 (top/highest) → 0.786...0 → -0.618 (bottom/lowest)
  const fibOrder = isBull
    ? ["-0.618", "0.0", "0.236", "0.382", "0.5", "0.618", "0.786", "1.0"]
    : ["1.0", "0.786", "0.618", "0.5", "0.382", "0.236", "0.0", "-0.618"];

  // Bar width: proportional to how far each price is from the bottom of the
  // full range (including -0.618 extension). Widest bar = highest price in bull,
  // widest bar = highest price in bear (which is -0.618 for bear).
  const allPrices = Object.values(fibLevels);
  const minP = Math.min(...allPrices);
  const maxP = Math.max(...allPrices);
  const priceRange = maxP - minP || 1;

  function barWidth(level) {
    const price = fibLevels[level];
    // Proportional distance from min price → 8% minimum so bars are visible
    return Math.max(8, Math.round(((price - minP) / priceRange) * 100));
  }

  return (
    <div className="mw-section">
      <div className="mw-header-row">
        <span className="mw-title">Mother Wave</span>
        <span className="mw-subtitle">
          Dominant wave driving current structure · Fib invalidation at{" "}
          <span className="mw-inv-price-inline">
            {fmt(invalidation)}
          </span>{" "}
          (−0.618)
        </span>
      </div>

      {/* Mother wave row — same columns as main table */}
      <div className="mw-table-wrap">
        <table className="cr-table mw-table">
          <thead>
            <tr>
              <th className="cr-th-wave">Wave</th>
              <th className="cr-th-wave cr-th-label">Wave</th>
              <th className="cr-th-dir">Direction</th>
              <th className="cr-th">Time / Price</th>
              <th className="cr-th">Time / Price</th>
              <th className="cr-th">Wave Δ (abs)</th>
              <th className="cr-th">Strength Bar</th>
              <th className="cr-th">Size</th>
            </tr>
          </thead>
          <tbody>
            <tr
              className="cr-row cr-row-clickable mw-row-highlight"
              onClick={() => onWaveClick(wave)}
              title="Click to open this wave on the chart"
            >
              <td><span className="cr-w-num">{wave.waveNum}</span></td>
              <td><span className="cr-w-label cr-w-label-standalone">{wave.label}</span></td>
              <td>
                {isBull
                  ? <span className="cr-badge cr-badge-bull">▲ Bullish</span>
                  : <span className="cr-badge cr-badge-bear">▼ Bearish</span>}
              </td>
              <td>
                <span className="cr-time">{toISTStr(wave.col1Time)}</span>
                <span className="cr-price">{fmt(wave.col1Price)}</span>
              </td>
              <td>
                <span className="cr-time">{toISTStr(wave.col2Time)}</span>
                <span className="cr-price">{fmt(wave.col2Price)}</span>
              </td>
              <td>
                <span className={`cr-delta ${isBull ? "cr-bull" : "cr-bear"}`}>
                  {isBull ? "+" : "−"}{wave.delta.toFixed(2)}
                </span>
              </td>
              <td>
                <div className="cr-bar-wrap">
                  <div className="cr-bar-bg">
                    <div className="cr-bar-fill"
                      style={{ width: "100%", background: isBull ? "#639922" : "#E24B4A" }} />
                  </div>
                  <span className="cr-bar-pct">100%</span>
                </div>
              </td>
              <td><SizeBadge delta={wave.delta} /></td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Fibonacci levels */}
      <div className="mw-fib-wrap">
        <div className="mw-fib-title">Fibonacci Retracement Levels</div>
        <div className="mw-fib-grid">
          {fibOrder.map((level) => {
            const price = fibLevels[level];
            const isInv = level === "-0.618";
            const isAnchor = level === "0.0" || level === "1.0";
            const bw = barWidth(level);

            return (
              <div key={level}
                className={`mw-fib-row${isInv ? " mw-fib-inv" : ""}${isAnchor ? " mw-fib-anchor" : ""}`}
              >
                <span className="mw-fib-level">{level}</span>
                <div className="mw-fib-bar-track">
                  <div className="mw-fib-bar-fill"
                    style={{
                      width: `${bw}%`,
                      background: isInv ? "#3d84ff" : isBull ? "#639922" : "#E24B4A",
                    }}
                  />
                </div>
                <span className={`mw-fib-price${isInv ? " mw-fib-inv-price" : ""}`}>
                  {fmt(price)}
                </span>
                {isInv && <span className="mw-fib-tag">Invalidation</span>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ReportsPage() {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();

  const [timeframe, setTimeframe] = useState(() => {
    try { const v = localStorage.getItem("tgg_resolution"); return v ? JSON.parse(v) : 15; }
    catch { return 15; }
  });

  const [symbol, setSymbol] = useState(() => {
    try { const v = localStorage.getItem("tgg_symbol"); return v ? JSON.parse(v) : "NSE:NIFTY50-INDEX"; }
    catch { return "NSE:NIFTY50-INDEX"; }
  });

  const [candles, setCandles] = useState([]);
  const [emaHighs, setEmaHighs] = useState([]);
  const [emaLows, setEmaLows] = useState([]);
  const [loadState, setLoadState] = useState("idle");
  const [errMsg, setErrMsg] = useState("");

  // Filters
  const [fDate, setFDate] = useState("all");
  const [fDir, setFDir] = useState("all");
  const [fSize, setFSize] = useState("all");
  const [fQ, setFQ] = useState("");

  // Sort
  const [sortCol, setSortCol] = useState("delta");
  const [sortDir, setSortDir] = useState("asc");

  // ── Fetch ───────────────────────────────────────────────────────────────────
  const fetchData = useCallback(async (sym, res) => {
    setLoadState("loading");
    setErrMsg("");
    setFDate("all"); setFDir("all"); setFSize("all"); setFQ("");
    setSortCol("delta"); setSortDir("asc");
    try {
      // Backend handles live vs cached automatically based on symbol's market hours.
      // Always GET — no POST/refresh decision needed on frontend.
      const r = await fetch(`${BACKEND}/api/chart?symbol=${encodeURIComponent(sym)}&resolution=${res}`);
      const data = r.ok ? await r.json() : null;

      if (data?.candles?.length) {
        setCandles(data.candles);
        setEmaHighs(data.emaHighs || []);
        setEmaLows(data.emaLows || []);
        setLoadState("done");
      } else {
        setLoadState("error");
        setErrMsg(`No candle data for ${sym}. Check backend connection and try Refresh.`);
      }
    } catch (e) {
      setLoadState("error");
      setErrMsg(e.message || "Network error connecting to backend.");
    }
  }, []);

  useEffect(() => { fetchData(symbol, timeframe); }, [symbol, timeframe, fetchData]);

  function handleSymbolSelect(sym) {
    setCandles([]);
    setEmaHighs([]);
    setEmaLows([]);
    setSymbol(sym);
    localStorage.setItem("tgg_symbol", JSON.stringify(sym));
  }

  function handleTimeframeChange(tf) {
    setCandles([]);
    setEmaHighs([]);
    setEmaLows([]);
    setTimeframe(tf);
    localStorage.setItem("tgg_resolution", JSON.stringify(tf));
  }

  // ── Wave computation ────────────────────────────────────────────────────────
  const { allWaves, allDates } = useMemo(() => {
    if (!candles.length) return { allWaves: [], allDates: [] };
    const { segments } = updateWavesIndicatorPure(candles, emaHighs, emaLows);
    const rows = buildTableRows(segments);
    const dates = [...new Set(rows.map((w) => w.date))].sort().reverse();
    return { allWaves: rows, allDates: dates };
  }, [candles, emaHighs, emaLows]);

  // ── Mother Wave — fetched from backend (single source of truth) ────────────
  const [motherWave, setMotherWave] = useState(null);

  useEffect(() => {
    if (!symbol || timeframe == null) return;
    let cancelled = false;
    // /api/chart auto-refreshes internally when market is live, so by the time
    // this fires the server cache is already fresh — no delay needed.
    fetch(`${BACKEND}/api/motherwave?symbol=${encodeURIComponent(symbol)}&resolution=${timeframe}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (cancelled) return;
        setMotherWave(data && data.wave ? data : null);
      })
      .catch(() => { if (!cancelled) setMotherWave(null); });
    return () => { cancelled = true; };
  }, [symbol, timeframe]);

  // ── Filter + sort ───────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let data = allWaves.filter((w) => {
      if (fDate !== "all" && w.date !== fDate) return false;
      if (fDir === "bull" && w.dir !== "bull") return false;
      if (fDir === "bear" && w.dir !== "bear") return false;
      if (fSize === "small" && w.delta >= 30) return false;
      if (fSize === "medium" && (w.delta < 30 || w.delta > 80)) return false;
      if (fSize === "large" && w.delta <= 80) return false;
      if (fQ && !String(w.waveNum).includes(fQ.trim())) return false;
      return true;
    });

    if (sortCol && sortDir) {
      data = [...data].sort((a, b) => {
        const av = sortCol === "delta" ? a.delta : sortCol === "col1Time" ? a.col1Time : a.col2Time;
        const bv = sortCol === "delta" ? b.delta : sortCol === "col1Time" ? b.col1Time : b.col2Time;
        if (sortDir === "asc") return typeof av === "number" ? av - bv : av > bv ? 1 : -1;
        return typeof av === "number" ? bv - av : bv > av ? 1 : -1;
      });
    } else {
      data = [...data].sort((a, b) => b.col1Time - a.col1Time);
    }

    return data;
  }, [allWaves, fDate, fDir, fSize, fQ, sortCol, sortDir]);

  // ── Stats ───────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    if (!filtered.length) return { total: 0, avg: "0.0", maxBull: "0.00", maxBear: "0.00" };
    const deltas = filtered.map((w) => w.delta);
    const bullWaves = filtered.filter((w) => w.dir === "bull");
    const bearWaves = filtered.filter((w) => w.dir === "bear");
    return {
      total: filtered.length,
      avg: (deltas.reduce((a, b) => a + b, 0) / deltas.length).toFixed(1),
      maxBull: bullWaves.length ? Math.max(...bullWaves.map((w) => w.delta)).toFixed(2) : "0.00",
      maxBear: bearWaves.length ? Math.max(...bearWaves.map((w) => w.delta)).toFixed(2) : "0.00",
    };
  }, [filtered]);

  const maxDelta = useMemo(() => filtered.reduce((acc, w) => Math.max(acc, w.delta), 1), [filtered]);

  // ── Open wave on ChartsPage in new tab ──────────────────────────────────────
  function handleWaveClick(w) {
    const params = new URLSearchParams({
      symbol,
      resolution: String(timeframe),
      waveFrom: String(w.col1Time),
      waveTo: String(w.col2Time),
    });
    window.open(`/charts?${params.toString()}`, "_blank");
  }

  // ── Sort helpers ─────────────────────────────────────────────────────────────
  function handleColSort(col) {
    if (sortCol === col) {
      if (sortDir === "asc") setSortDir("desc");
      else if (sortDir === "desc") { setSortDir(null); setSortCol(null); }
      else { setSortDir("asc"); setSortCol(col); }
    } else { setSortCol(col); setSortDir("asc"); }
  }
  function clearSort() { setSortCol(null); setSortDir(null); }

  function sortArrow(col) {
    if (sortCol !== col || !sortDir) return <span className="cr-sort-arrow inactive">↕</span>;
    return <span className="cr-sort-arrow active">{sortDir === "" ? "↑" : "↓"}</span>;
  }

  const sortLabel = !sortCol ? "Sort by Δ" : sortDir === "asc" ? "Δ Ascending" : "Δ Descending";
  const isSortedByDelta = sortCol === "delta" && sortDir;
  const tfLabel = TIMEFRAMES.find((t) => t.value === timeframe)?.label || String(timeframe);
  let lastDate = "";

  return (
    <div className="cr-page">

      {/* ── Topbar ─────────────────────────────────────────────────────────── */}
      <div className="cr-topbar">
        <button className="cr-back-btn" onClick={() => navigate("/")} title="Back to Home">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
        </button>

        <div className="cr-logo">
          <img src="/tg-levels-logo.png" alt="TG Levels" className="cr-logo-img" />
        </div>

        {/* Symbol search */}
        <div className="cr-topbar-search">
          <SymbolSearch symbol={symbol} onSelect={handleSymbolSelect} />
        </div>

        <div style={{ flex: 1 }} />

        {/* Timeframe pills */}
        <div className="cr-tf-group">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.value}
              className={`cr-tf-btn ${timeframe === tf.value ? "active" : ""}`}
              onClick={() => handleTimeframeChange(tf.value)}
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

        <button
          className="cr-theme-btn"
          onClick={toggleTheme}
          title={theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
        >
          {theme === "dark" ? "☀" : "🌙"}
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

            {/* ── Mother Wave Section ─────────────────────────────────────── */}
            <MotherWaveSection motherWave={motherWave} onWaveClick={handleWaveClick} />

            {/* Filter controls */}
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
                    <th className="cr-th-wave">Wave</th>
                    <th className="cr-th-wave cr-th-label">Wave</th>
                    <th className="cr-th-dir">Direction</th>
                    <th
                      className={`cr-th-sortable ${sortCol === "col1Time" ? "cr-th-sorted" : ""}`}
                      onClick={() => handleColSort("col1Time")}
                    >
                      Time / Price {sortArrow("col1Time")}
                    </th>
                    <th
                      className={`cr-th-sortable ${sortCol === "col2Time" ? "cr-th-sorted" : ""}`}
                      onClick={() => handleColSort("col2Time")}
                    >
                      Time / Price {sortArrow("col2Time")}
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
                    filtered.map((w) => {
                      const showDateSep = !isSortedByDelta && w.date !== lastDate;
                      if (showDateSep) lastDate = w.date;
                      const barW = Math.max(4, Math.round((w.delta / maxDelta) * 100));
                      const isBull = w.dir === "bull";
                      const isMotherWave = motherWave && w.waveNum === motherWave.wave.waveNum;

                      return (
                        <React.Fragment key={w.id}>
                          {showDateSep && (
                            <tr className="cr-date-sep">
                              <td colSpan={8}>— {w.date} —</td>
                            </tr>
                          )}
                          <tr
                            className={`cr-row cr-row-clickable${isMotherWave ? " cr-row-mother" : ""}`}
                            onClick={() => handleWaveClick(w)}
                            title={isMotherWave ? "Mother Wave — click to open on chart" : "Click to open this wave on the chart"}
                          >
                            <td>
                              <span className="cr-w-num">{w.waveNum}</span>
                              {isMotherWave && <span className="cr-mother-tag">M</span>}
                            </td>
                            <td><span className="cr-w-label cr-w-label-standalone">{w.label}</span></td>
                            <td>
                              {isBull
                                ? <span className="cr-badge cr-badge-bull">▲ Bullish</span>
                                : <span className="cr-badge cr-badge-bear">▼ Bearish</span>}
                            </td>
                            <td>
                              <span className="cr-time">{toISTStr(w.col1Time)}</span>
                              <span className="cr-price">{fmt(w.col1Price)}</span>
                            </td>
                            <td>
                              <span className="cr-time">{toISTStr(w.col2Time)}</span>
                              <span className="cr-price">{fmt(w.col2Price)}</span>
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

function SizeBadge({ delta }) {
  if (delta < 30) return <span className="cr-badge cr-badge-sm">Small</span>;
  if (delta <= 80) return <span className="cr-badge cr-badge-med">Medium</span>;
  return <span className="cr-badge cr-badge-lg-bull">Large</span>;
}