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

// ── Mother Wave Detection ──────────────────────────────────────────────────────
//
// Algorithm:
//   1. Sort all waves by delta DESC to find the largest candidate.
//   2. Start with the wave that has the highest absolute delta — that's the first
//      Mother Wave candidate.
//   3. Compute the Fibonacci -0.168 invalidation level for that wave:
//        • Bullish wave  (toSide=high):  inv = toPrice + 0.168 × (toPrice - fromPrice)
//          → invalidated if any SUBSEQUENT wave's toPrice (high end) > inv
//        • Bearish wave  (toSide=low):   inv = toPrice - 0.168 × (fromPrice - toPrice)
//          → invalidated if any SUBSEQUENT wave's toPrice (low end)  < inv
//   4. Walk chronologically through waves that come AFTER the candidate.
//      If any of those waves crosses the -0.168 level:
//        • Discard current candidate.
//        • From the waves AFTER the current candidate's end-time, pick the
//          new largest-delta wave as the new candidate.
//        • Repeat the fib check on the new candidate.
//   5. The final un-invalidated candidate is the Mother Wave.
//      Return it along with its fib levels for display.
//
function detectMotherWave(waves) {
  if (!waves || waves.length === 0) return null;

  // Work on a chronologically sorted copy (by start time ascending)
  const byTime = [...waves].sort((a, b) => a.col1Time - b.col1Time);

  // Helper: compute -0.168 invalidation price for a candidate wave row
  function fibInvalidation(w) {
    const span = Math.abs(w.col2Price - w.col1Price);
    if (w.dir === "bull") {
      // Bullish: extends above the high → inv is above col2Price
      return w.col2Price + 0.168 * span;
    } else {
      // Bearish: extends below the low → inv is below col2Price
      return w.col2Price - 0.168 * span;
    }
  }

  // Helper: check if a wave crosses the invalidation level of the candidate
  function isInvalidated(candidate, inv, wave) {
    // Only waves that started AFTER the candidate ended are checked
    if (wave.col1Time <= candidate.col2Time) return false;
    if (candidate.dir === "bull") {
      // Invalidated if any subsequent wave's toPrice (high side) crosses above inv
      return wave.col2Price > inv;
    } else {
      // Invalidated if any subsequent wave's toPrice (low side) drops below inv
      return wave.col2Price < inv;
    }
  }

  // Helper: pick the largest-delta wave from a subset
  function largestInSubset(subset) {
    if (!subset.length) return null;
    return subset.reduce((best, w) => (w.delta > best.delta ? w : best), subset[0]);
  }

  // Start: candidate = largest delta overall
  let candidate = largestInSubset(byTime);
  const MAX_ITER = 20; // safety guard against infinite loops

  for (let iter = 0; iter < MAX_ITER; iter++) {
    if (!candidate) break;

    const inv = fibInvalidation(candidate);

    // Find waves strictly after this candidate's end time
    const afterCandidate = byTime.filter((w) => w.col1Time > candidate.col2Time);

    // Check if any of those waves invalidates the candidate's fib
    const invalidatingWave = afterCandidate.find((w) => isInvalidated(candidate, inv, w));

    if (!invalidatingWave) {
      // No invalidation → this is the final Mother Wave
      break;
    }

    // Invalidated: pick next candidate from waves that start AFTER the
    // invalidating wave's start time (not the old candidate's end)
    const pool = byTime.filter((w) => w.col1Time > candidate.col2Time);
    const next = largestInSubset(pool);

    if (!next || next.waveNum === candidate.waveNum) break; // can't progress

    candidate = next;
  }

  if (!candidate) return null;

  // Build full fib level set for display
  const span = Math.abs(candidate.col2Price - candidate.col1Price);
  const isBull = candidate.dir === "bull";
  const origin = candidate.col1Price;
  const end = candidate.col2Price;

  const fibLevels = isBull
    ? {
      "1.0": end,
      "0.786": end - 0.214 * span,
      "0.618": end - 0.382 * span,
      "0.5": end - 0.5 * span,
      "0.382": end - 0.618 * span,
      "0.236": end - 0.764 * span,
      "0.0": origin,
      "-0.168": end + 0.168 * span,
    }
    : {
      "1.0": end,
      "0.786": end + 0.214 * span,
      "0.618": end + 0.382 * span,
      "0.5": end + 0.5 * span,
      "0.382": end + 0.618 * span,
      "0.236": end + 0.764 * span,
      "0.0": origin,
      "-0.168": end - 0.168 * span,
    };

  return { wave: candidate, fibLevels, invalidation: fibLevels["-0.168"] };
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

  const fibOrder = isBull
    ? ["-0.168", "1.0", "0.786", "0.618", "0.5", "0.382", "0.236", "0.0"]
    : ["-0.168", "1.0", "0.786", "0.618", "0.5", "0.382", "0.236", "0.0"];

  return (
    <div className="mw-section">
      <div className="mw-header-row">
        <span className="mw-title">Mother Wave</span>
        <span className="mw-subtitle">
          Dominant wave driving current structure · Fib invalidation at{" "}
          <span className={`mw-inv-price ${isBull ? "cr-bull" : "cr-bear"}`}>
            {fmt(invalidation)}
          </span>{" "}
          (−0.168)
        </span>
      </div>

      {/* Mother wave table — same columns as main table */}
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
                    <div
                      className="cr-bar-fill"
                      style={{ width: "100%", background: isBull ? "#639922" : "#E24B4A" }}
                    />
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
            const isInvalidationLevel = level === "-0.168";
            const isOrigin = level === "0.0";
            const isEnd = level === "1.0";
            return (
              <div
                key={level}
                className={`mw-fib-row ${isInvalidationLevel ? "mw-fib-inv" : ""} ${isOrigin || isEnd ? "mw-fib-anchor" : ""}`}
              >
                <span className="mw-fib-level">{level}</span>
                <div className="mw-fib-bar-track">
                  <div
                    className="mw-fib-bar-fill"
                    style={{
                      width: isInvalidationLevel ? "100%" : `${Math.max(8, parseFloat(level) * 100)}%`,
                      opacity: isInvalidationLevel ? 0.5 : 0.8,
                      background: isInvalidationLevel
                        ? (isBull ? "#3d84ff" : "#3d84ff")
                        : isBull ? "#639922" : "#E24B4A",
                    }}
                  />
                </div>
                <span className={`mw-fib-price ${isInvalidationLevel ? "mw-fib-inv-price" : ""}`}>
                  {fmt(price)}
                </span>
                {isInvalidationLevel && (
                  <span className="mw-fib-tag">Invalidation</span>
                )}
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
      const isLive = (() => {
        const now = new Date();
        const istMin = ((now.getUTCHours() * 60 + now.getUTCMinutes()) + 330) % 1440;
        const dow = new Date(now.getTime() + 330 * 60000).getUTCDay();
        return dow !== 0 && dow !== 6 && istMin >= 555 && istMin < 931;
      })();
      const url = isLive
        ? `${BACKEND}/api/chart/refresh?symbol=${encodeURIComponent(sym)}&resolution=${res}`
        : `${BACKEND}/api/chart?symbol=${encodeURIComponent(sym)}&resolution=${res}`;
      const r = await fetch(url, { method: isLive ? "POST" : "GET" });
      const data = r.ok ? await r.json() : null;

      if (data?.candles?.length) {
        setCandles(data.candles);
        setEmaHighs(data.emaHighs || []);
        setEmaLows(data.emaLows || []);
        setLoadState("done");
        return;
      }

      const getUrl = `${BACKEND}/api/chart?symbol=${encodeURIComponent(sym)}&resolution=${res}`;
      const r2 = await fetch(getUrl);
      const data2 = r2.ok ? await r2.json() : null;

      if (data2?.candles?.length) {
        setCandles(data2.candles);
        setEmaHighs(data2.emaHighs || []);
        setEmaLows(data2.emaLows || []);
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

  // ── Mother Wave computation ─────────────────────────────────────────────────
  const motherWave = useMemo(() => detectMotherWave(allWaves), [allWaves]);

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