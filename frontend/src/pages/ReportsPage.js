// ReportsPage.js
// ─────────────────────────────────────────────────────────────────────────────
// Wave Report page — tabular view of all wave pivots.
//
// Uses the same chartData flow as ChartsPage (via useSocket + refresh) so
// data is always in sync and never stale.
//
// TABLE COLUMNS:
//   Sr.No | Wave Number | Timestamp | Category | Direction | Value | Wave Size
//
// LOGIC:
//   - Data is fetched fresh on mount and whenever symbol/resolution changes.
//   - Waves are grouped by wave number pair (HH/LH + HL/LL alternate pairs).
//   - Wave Size = |High pivot price − Low pivot price| within consecutive pair.
//   - Rows within each wave group keep natural order; groups sorted desc by size.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useSocket } from "../hooks/useSocket";
import { buildDefaultIndicators } from "../indicators/indicatorRegistry";

// Re-use the same WavesIndicator logic to compute pivots from raw candles
import { updateWavesIndicatorPure } from "../indicators/WavesIndicator";

import "./ReportsPage.css";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function loadPref(key, fallback) {
  try {
    const v = localStorage.getItem("tgg_" + key);
    return v !== null ? JSON.parse(v) : fallback;
  } catch { return fallback; }
}

function formatTimestamp(tsMs) {
  if (!tsMs) return "—";
  const d = new Date(tsMs);
  const date = d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "2-digit", year: "numeric" });
  const time = d.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false });
  return `${date} ${time}`;
}

function formatPrice(v) {
  if (v == null) return "—";
  return Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const CATEGORY_LABELS = {
  HH: "Higher High",
  LH: "Lower High",
  HL: "Higher Low",
  LL: "Lower Low",
};

const DIRECTION_FROM_SIDE = {
  high: "Up",
  low: "Down",
};

const CATEGORY_COLOR = {
  HH: "#00d97e",
  LH: "#3d84ff",
  HL: "#ffc135",
  LL: "#ff4560",
};

// ─── Build wave groups from enriched pivots ───────────────────────────────────
// Each "wave" is a pair: one high pivot + one low pivot.
// Wave size = absolute difference between consecutive high/low pivot prices.
function buildWaveGroups(enrichedPivots) {
  if (!enrichedPivots.length) return [];

  // Sort by barIndex ascending (natural wave order)
  const sorted = [...enrichedPivots].sort((a, b) => a.barIndex - b.barIndex);

  // Pair consecutive pivots to form wave groups
  const groups = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    const waveSize = Math.abs(a.price - b.price);
    groups.push({
      waveNum: a.waveNum,
      pivots: [a, b],
      waveSize,
    });
  }

  // Sort groups by wave size DESCENDING
  groups.sort((a, b) => b.waveSize - a.waveSize);

  return groups;
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function ReportsPage() {
  const navigate = useNavigate();
  const { chartData, loading, error, refresh } = useSocket();

  const [symbol, setSymbol] = useState(() => loadPref("symbol", "NSE:NIFTY50-INDEX"));
  const [resolution, setResolution] = useState(() => loadPref("resolution", 3));
  const [sortAsc, setSortAsc] = useState(false); // wave size sort direction

  // Initial fetch
  const [didFetch, setDidFetch] = useState(false);
  useEffect(() => {
    if (!didFetch) {
      setDidFetch(true);
      refresh(symbol, resolution);
    }
  }, []); // eslint-disable-line

  const candles = chartData?.candles || [];
  const emaHighs = chartData?.emaHighs || [];
  const emaLows = chartData?.emaLows || [];

  // ── Derive wave pivots using pure (no-DOM) computation ──────────────────
  const enrichedPivots = useMemo(() => {
    if (!candles.length) return [];
    const result = updateWavesIndicatorPure(candles, emaHighs, emaLows);
    return result.pivots ?? result;
  }, [candles, emaHighs, emaLows]);

  // ── Build flat table rows from wave groups ──────────────────────────────
  const { waveGroups, flatRows } = useMemo(() => {
    const groups = buildWaveGroups(enrichedPivots);

    // Apply user sort direction
    const sorted = sortAsc ? [...groups].reverse() : groups;

    const rows = [];
    let sr = 1;
    sorted.forEach((group) => {
      group.pivots.forEach((piv) => {
        rows.push({
          sr: sr++,
          waveNum: group.waveNum,
          timestamp: piv.time,
          category: piv.waveType,
          direction: DIRECTION_FROM_SIDE[piv.side] ?? "—",
          value: piv.price,
          waveSize: group.waveSize,
          _groupFirst: piv === group.pivots[0],
          _groupSize: group.pivots.length,
        });
      });
    });

    return { waveGroups: sorted, flatRows: rows };
  }, [enrichedPivots, sortAsc]);

  function handleRefresh() {
    refresh(symbol, resolution);
  }

  const showLoading = loading && candles.length === 0;

  return (
    <div className="rp-page">

      {/* ── Topbar ──────────────────────────────────────────────────────── */}
      <div className="rp-topbar">
        <button className="rp-back-btn" onClick={() => navigate("/")} title="Home">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          Home
        </button>

        <span className="rp-topbar-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="rp-topbar-icon">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
          </svg>
          Wave Report
        </span>

        {/* Symbol + Resolution controls — stay in sync with ChartsPage via localStorage */}
        <div className="rp-controls">
          <select
            className="rp-select"
            value={symbol}
            onChange={(e) => {
              setSymbol(e.target.value);
              localStorage.setItem("tgg_symbol", JSON.stringify(e.target.value));
              refresh(e.target.value, resolution);
            }}
          >
            <option value="NSE:NIFTY50-INDEX">NIFTY50</option>
            <option value="NSE:BANKNIFTY-INDEX">BANKNIFTY</option>
          </select>

          {[1, 3, 5, 15, 60].map((r) => (
            <button
              key={r}
              className={`rp-res-btn ${resolution === r ? "rp-res-btn--active" : ""}`}
              onClick={() => {
                setResolution(r);
                localStorage.setItem("tgg_resolution", JSON.stringify(r));
                refresh(symbol, r);
              }}
            >
              {r === 60 ? "1H" : `${r}m`}
            </button>
          ))}

          <button className="rp-refresh-btn" onClick={handleRefresh} title="Refresh">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Main table area ──────────────────────────────────────────────── */}
      <main className="rp-main">

        {/* Meta bar */}
        <div className="rp-meta-bar">
          <span className="rp-meta-sym">{symbol}</span>
          <span className="rp-meta-sep">·</span>
          <span className="rp-meta-info">{enrichedPivots.length} pivots · {waveGroups.length} wave pairs</span>
          <span style={{ flex: 1 }} />
          <button
            className="rp-sort-btn"
            onClick={() => setSortAsc((p) => !p)}
            title="Toggle wave size sort direction"
          >
            Wave Size {sortAsc ? "▲ ASC" : "▼ DESC"}
          </button>
        </div>

        {showLoading ? (
          <div className="rp-loading">
            <div className="rp-spinner" />
            <span>Loading wave data…</span>
          </div>
        ) : error ? (
          <div className="rp-error">⚠ {error}</div>
        ) : flatRows.length === 0 ? (
          <div className="rp-empty">
            <div className="rp-empty-icon">📊</div>
            <div className="rp-empty-title">No Wave Data</div>
            <div className="rp-empty-sub">Run the backend generator and click Refresh.</div>
          </div>
        ) : (
          <div className="rp-table-wrap">
            <table className="rp-table">
              <thead>
                <tr>
                  <th>Sr.</th>
                  <th>Wave #</th>
                  <th>Timestamp</th>
                  <th>Category</th>
                  <th>Direction</th>
                  <th>Value</th>
                  <th
                    className="rp-th-sortable"
                    onClick={() => setSortAsc((p) => !p)}
                    title="Click to toggle sort"
                  >
                    Wave Size {sortAsc ? "▲" : "▼"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {flatRows.map((row, idx) => (
                  <tr
                    key={`${row.waveNum}-${row.timestamp}-${idx}`}
                    className={row._groupFirst ? "rp-row rp-row--group-start" : "rp-row"}
                  >
                    <td className="rp-td rp-td-sr">{row.sr}</td>
                    <td className="rp-td rp-td-wave">
                      <span className="rp-wave-badge">Wave {row.waveNum}</span>
                    </td>
                    <td className="rp-td rp-td-time">{formatTimestamp(row.timestamp)}</td>
                    <td className="rp-td">
                      <span
                        className="rp-category-badge"
                        style={{
                          color: CATEGORY_COLOR[row.category] ?? "var(--text)",
                          background: (CATEGORY_COLOR[row.category] ?? "#fff") + "18",
                        }}
                      >
                        {CATEGORY_LABELS[row.category] ?? row.category}
                      </span>
                    </td>
                    <td className="rp-td">
                      <span className={`rp-dir ${row.direction === "Up" ? "rp-dir--up" : "rp-dir--down"}`}>
                        {row.direction === "Up" ? "▲" : "▼"} {row.direction}
                      </span>
                    </td>
                    <td className="rp-td rp-td-value">{formatPrice(row.value)}</td>
                    <td className="rp-td rp-td-size">
                      {row._groupFirst ? formatPrice(row.waveSize) : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}