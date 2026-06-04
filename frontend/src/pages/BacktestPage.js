/**
 * BacktestPage.js
 * Scans 350 symbols for candles that:
 *   1. Occur AFTER the Mother Wave tip
 *   2. Touch the HOT (0.618) or NEAR (0.382) zone  [tol = span * 0.05]
 *   3. Are red (close < open)
 *   4. Close below EMA9 low
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { io } from "socket.io-client";
import { BACKEND } from "../config";
import { useTheme } from "../App";
import "./BacktestPage.css";

const TIMEFRAMES = [
  { value: 1, label: "1m" },
  { value: 3, label: "3m" },
  { value: 5, label: "5m" },
  { value: 15, label: "15m" },
  { value: 60, label: "1h" },
  { value: 1440, label: "1D" },
  { value: 10080, label: "1W" },
];

// ── Formatters ────────────────────────────────────────────────────────────────
const numFmt = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function fmt(n) { return n == null ? "—" : numFmt.format(Number(n)); }

function toIST(tsMs) {
  if (!tsMs) return "—";
  const d = new Date(tsMs + 5.5 * 60 * 60 * 1000);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mon = d.toLocaleString("en", { month: "short", timeZone: "UTC" });
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${dd}/${mon} ${hh}:${mm}`;
}

function tickerOf(sym) {
  const idx = (sym || "").indexOf(":");
  return idx >= 0 ? sym.slice(idx + 1) : sym;
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function BacktestPage() {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const socketRef = useRef(null);

  const [resolution, setResolution] = useState(15);
  const [status, setStatus] = useState(null);   // from /api/backtest/status
  const [progress, setProgress] = useState(null);   // { total, done, hits }
  const [hits, setHits] = useState([]);
  const [phase, setPhase] = useState("idle"); // idle | running | done

  // Filters
  const [fZone, setFZone] = useState("all");  // all | HOT | NEAR
  const [fDir, setFDir] = useState("all");  // all | bull | bear
  const [fSym, setFSym] = useState("");

  // ── Fetch initial status ───────────────────────────────────────────────────
  const fetchStatus = useCallback(async () => {
    try {
      const s = await fetch(`${BACKEND}/api/backtest/status`).then(r => r.json());
      setStatus(s);
      if (s.running) setPhase("running");
    } catch { /* backend not up yet */ }
  }, []);

  const fetchResults = useCallback(async () => {
    try {
      const r = await fetch(`${BACKEND}/api/backtest/results`).then(r => r.json());
      if (r.results?.length) { setHits(r.results); setPhase("done"); }
    } catch { /* ignore */ }
  }, []);

  // ── Socket setup ───────────────────────────────────────────────────────────
  useEffect(() => {
    fetchStatus();
    fetchResults();

    const sock = io(BACKEND, { transports: ["websocket"] });
    socketRef.current = sock;

    sock.on("backtest_start", (d) => {
      setPhase("running");
      setHits([]);
      setProgress({ total: d.total, done: 0, hits: 0 });
    });

    sock.on("backtest_progress", (d) => {
      setProgress({ total: d.total, done: d.done, hits: d.hits });
    });

    sock.on("backtest_hit", (hit) => {
      setHits(prev => [...prev, hit]);
    });

    sock.on("backtest_complete", () => {
      setPhase("done");
      setProgress(null);
      fetchStatus();
    });

    return () => { sock.disconnect(); };
  }, [fetchStatus, fetchResults]);

  // ── Run / Stop ─────────────────────────────────────────────────────────────
  async function handleRun() {
    if (phase === "running") {
      await fetch(`${BACKEND}/api/backtest/stop`, { method: "POST" });
      setPhase("idle");
      setProgress(null);
      return;
    }
    setHits([]);
    setPhase("running");
    setProgress(null);
    try {
      await fetch(`${BACKEND}/api/backtest/trigger`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolution }),
      });
    } catch (e) {
      console.error("[Backtest] Trigger failed:", e);
      setPhase("idle");
    }
  }

  // ── Filtered results ───────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return hits.filter(h => {
      if (fZone !== "all" && h.zone !== fZone) return false;
      if (fDir !== "all" && h.mwDir !== fDir) return false;
      if (fSym.trim() && !tickerOf(h.symbol).toLowerCase().includes(fSym.trim().toLowerCase())) return false;
      return true;
    });
  }, [hits, fZone, fDir, fSym]);

  const isRunning = phase === "running";
  const pct = progress ? Math.round((progress.done / Math.max(1, progress.total)) * 100) : 0;
  const tfLabel = TIMEFRAMES.find(t => t.value === resolution)?.label || String(resolution);

  // ── Stats ──────────────────────────────────────────────────────────────────
  const hotCount = hits.filter(h => h.zone === "HOT").length;
  const nearCount = hits.filter(h => h.zone === "NEAR").length;
  const symCount = new Set(hits.map(h => h.symbol)).size;

  return (
    <div className="bt-page">

      {/* ── Topbar ──────────────────────────────────────────────────────────── */}
      <div className="bt-topbar">
        <button className="bt-back-btn" onClick={() => navigate("/")} title="Back to Home">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
        </button>

        <div className="bt-logo">
          <img src="/tg-levels-logo.png" alt="TG Levels" className="bt-logo-img" />
        </div>

        <div className="bt-title-wrap">
          <span className="bt-title">Backtest</span>
          <span className="bt-subtitle">MW Zone · Red Candle · EMA9L</span>
        </div>

        <div style={{ flex: 1 }} />

        {/* Timeframe */}
        <div className="bt-tf-group">
          {TIMEFRAMES.map(tf => (
            <button
              key={tf.value}
              className={`bt-tf-btn ${resolution === tf.value ? "active" : ""}`}
              onClick={() => !isRunning && setResolution(tf.value)}
              disabled={isRunning}
            >
              {tf.label}
            </button>
          ))}
        </div>

        {/* Run / Stop */}
        <button
          className={`bt-run-btn ${isRunning ? "bt-run-btn--stop" : "bt-run-btn--run"}`}
          onClick={handleRun}
        >
          {isRunning
            ? <><span className="bt-spinner" />Stop</>
            : <><span className="bt-run-icon">▶</span>Run {tfLabel}</>
          }
        </button>

        <button className="bt-theme-btn" onClick={toggleTheme} title="Toggle theme">
          {theme === "dark" ? "☀" : "🌙"}
        </button>
      </div>

      {/* ── Progress bar ────────────────────────────────────────────────────── */}
      <div className="bt-progress-wrap">
        <div className="bt-progress-bar" style={{ width: isRunning ? `${pct}%` : phase === "done" ? "100%" : "0%" }} />
      </div>

      {/* ── Body ────────────────────────────────────────────────────────────── */}
      <div className="bt-body">

        {/* Idle state */}
        {phase === "idle" && (
          <div className="bt-idle">
            <div className="bt-idle-icon">⚡</div>
            <div className="bt-idle-title">Ready to scan</div>
            <div className="bt-idle-desc">
              Scans all 350 symbols for red candles closing below EMA9 Low<br />
              inside the Mother Wave 0.618 (HOT) or 0.382 (NEAR) zone,<br />
              only on candles <strong>after</strong> the MW tip.
            </div>
            <button className="bt-idle-btn" onClick={handleRun}>
              ▶ Run Backtest ({tfLabel})
            </button>
          </div>
        )}

        {/* Running + no hits yet */}
        {isRunning && hits.length === 0 && (
          <div className="bt-scanning">
            <div className="bt-scan-spinner" />
            <div className="bt-scan-text">
              Scanning {progress?.done ?? 0} / {progress?.total ?? "…"} symbols…
            </div>
          </div>
        )}

        {/* Results — show as soon as hits arrive */}
        {(hits.length > 0 || phase === "done") && (
          <>
            {/* Stats bar */}
            <div className="bt-stat-row">
              <div className="bt-stat">
                <div className="bt-stat-lbl">Total Hits</div>
                <div className="bt-stat-val">{hits.length}</div>
              </div>
              <div className="bt-stat">
                <div className="bt-stat-lbl">HOT (0.618)</div>
                <div className="bt-stat-val bt-hot">{hotCount}</div>
              </div>
              <div className="bt-stat">
                <div className="bt-stat-lbl">NEAR (0.382)</div>
                <div className="bt-stat-val bt-near">{nearCount}</div>
              </div>
              <div className="bt-stat">
                <div className="bt-stat-lbl">Symbols Hit</div>
                <div className="bt-stat-val">{symCount}</div>
              </div>
              {isRunning && progress && (
                <div className="bt-stat bt-stat-progress">
                  <div className="bt-stat-lbl">Progress</div>
                  <div className="bt-stat-val">{progress.done} / {progress.total}</div>
                </div>
              )}
              {phase === "done" && status?.lastDurationMs && (
                <div className="bt-stat">
                  <div className="bt-stat-lbl">Scan Time</div>
                  <div className="bt-stat-val">{(status.lastDurationMs / 1000).toFixed(1)}s</div>
                </div>
              )}
            </div>

            {/* Filters */}
            <div className="bt-filters">
              <select value={fZone} onChange={e => setFZone(e.target.value)} className="bt-select">
                <option value="all">All zones</option>
                <option value="HOT">HOT (0.618)</option>
                <option value="NEAR">NEAR (0.382)</option>
              </select>

              <select value={fDir} onChange={e => setFDir(e.target.value)} className="bt-select">
                <option value="all">All MW directions</option>
                <option value="bull">Bull MW ▲</option>
                <option value="bear">Bear MW ▼</option>
              </select>

              <div className="bt-sym-search-wrap">
                <input
                  type="text"
                  value={fSym}
                  onChange={e => setFSym(e.target.value)}
                  placeholder="Symbol filter…"
                  className="bt-sym-search"
                />
                {fSym && <button className="bt-sym-clear" onClick={() => setFSym("")}>✕</button>}
              </div>

              <span className="bt-row-count">{filtered.length} rows</span>
            </div>

            {/* Table */}
            <div className="bt-table-wrap">
              <table className="bt-table">
                <thead>
                  <tr>
                    <th>MW No.</th>
                    <th>Symbol</th>
                    <th>MW Timestamp</th>
                    <th>MW Δ</th>
                    <th>MW Dir</th>
                    <th>Zone</th>
                    <th>Candle Time</th>
                    <th>Open</th>
                    <th>High</th>
                    <th>Low</th>
                    <th>Close</th>
                    <th>EMA9L</th>
                    <th>Fib Lvl</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={13} className="bt-no-data">
                        No hits match the current filters.
                      </td>
                    </tr>
                  ) : (
                    filtered.map((h, i) => {
                      const isBull = h.mwDir === "bull";
                      const isHot = h.zone === "HOT";
                      const fibLvl = isHot ? h.fib618 : h.fib382;
                      return (
                        <tr
                          key={i}
                          className={`bt-row bt-row-clickable ${isHot ? "bt-row-hot" : "bt-row-near"}`}
                          onClick={() => {
                            const fibDrawing = encodeURIComponent(JSON.stringify({
                              p1Price: h.mwToPrice,
                              p1Time: Math.round(h.mwTimestamp / 1000),
                              p2Price: h.mwFromPrice,
                              p2Time: Math.round(h.mwFromTime / 1000),
                            }));
                            const params = new URLSearchParams({
                              symbol: h.symbol,
                              resolution: String(resolution),
                              waveFrom: String(h.mwFromTime),
                              waveTo: String(h.mwTimestamp),
                              fibDrawing,
                            });
                            window.open(`/charts?${params.toString()}`, "_blank");
                          }}
                          title="Click to open on chart"
                        >
                          {/* MW No. */}
                          <td>
                            <span className={`bt-mwno ${h.mwNo === 0 ? "bt-mwno-current" : "bt-mwno-prev"}`}>
                              {h.mwNo === 0 ? "0" : h.mwNo}
                            </span>
                          </td>

                          {/* Symbol */}
                          <td>
                            <div className="bt-sym">
                              <span className="bt-sym-ticker">{tickerOf(h.symbol)}</span>
                              <span className="bt-sym-exch">{h.symbol.split(":")[0]}</span>
                            </div>
                          </td>

                          {/* MW Timestamp — Start → End */}
                          <td>
                            <div className="bt-mw-ts">
                              <span className="bt-mw-ts-start">{toIST(h.mwFromTime)}</span>
                              <span className="bt-mw-ts-arrow">→</span>
                              <span className="bt-mw-ts-end">{toIST(h.mwTimestamp)}</span>
                            </div>
                          </td>

                          {/* MW Delta */}
                          <td>
                            <span className={`bt-delta ${isBull ? "bt-bull" : "bt-bear"}`}>
                              {isBull ? "+" : "−"}{fmt(h.mwDelta)}
                            </span>
                          </td>

                          {/* MW Direction */}
                          <td>
                            {isBull
                              ? <span className="bt-badge bt-badge-bull">▲ Bull</span>
                              : <span className="bt-badge bt-badge-bear">▼ Bear</span>}
                          </td>

                          {/* Zone */}
                          <td>
                            {isHot
                              ? <span className="bt-badge bt-badge-hot">HOT 0.618</span>
                              : <span className="bt-badge bt-badge-near">NEAR 0.382</span>}
                          </td>

                          {/* Candle Time */}
                          <td className="bt-time">{toIST(h.candleTime)}</td>

                          {/* OHLC */}
                          <td className="bt-price">{fmt(h.open)}</td>
                          <td className="bt-price">{fmt(h.high)}</td>
                          <td className="bt-price">{fmt(h.low)}</td>
                          <td className="bt-price bt-close-red">{fmt(h.close)}</td>

                          {/* EMA9L */}
                          <td className="bt-price bt-ema">{fmt(h.ema9L)}</td>

                          {/* Fib level hit */}
                          <td className="bt-price bt-fib">{fmt(fibLvl)}</td>
                        </tr>
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