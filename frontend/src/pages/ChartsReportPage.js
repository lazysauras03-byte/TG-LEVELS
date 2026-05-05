// ChartsReportPage.js
// New report page opened from the TG Dashboard (Charts view)
// Shows NSE:NIFTY50-INDEX Unified Wave Table with full filters, sorting & search
import React, { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import "./ChartsReportPage.css";

// ── Raw wave data ──────────────────────────────────────────────────────────────
const RAW = [
  { n: 1, hd: '21/04', ht: '10:06', hv: 24524.85, ld: '21/04', lt: '10:27', lv: 24487.50 },
  { n: 2, hd: '21/04', ht: '11:06', hv: 24565.10, ld: '21/04', lt: '11:36', lv: 24513.65 },
  { n: 3, hd: '21/04', ht: '11:45', hv: 24543.95, ld: '21/04', lt: '11:51', lv: 24521.80 },
  { n: 4, hd: '21/04', ht: '12:21', hv: 24570.95, ld: '21/04', lt: '12:27', lv: 24545.60 },
  { n: 5, hd: '21/04', ht: '12:30', hv: 24571.25, ld: '21/04', lt: '13:09', lv: 24525.35 },
  { n: 6, hd: '21/04', ht: '13:33', hv: 24569.80, ld: '21/04', lt: '13:42', lv: 24523.50 },
  { n: 7, hd: '21/04', ht: '13:57', hv: 24563.80, ld: '21/04', lt: '14:09', lv: 24522.60 },
  { n: 8, hd: '21/04', ht: '14:21', hv: 24584.65, ld: '21/04', lt: '14:42', lv: 24526.05 },
  { n: 9, hd: '21/04', ht: '15:00', hv: 24600.45, ld: '21/04', lt: '15:00', lv: 24548.90 },
  { n: 10, hd: '21/04', ht: '15:15', hv: 24601.70, ld: '22/04', lt: '10:00', lv: 24352.90 },
  { n: 11, hd: '22/04', ht: '10:54', hv: 24447.80, ld: '22/04', lt: '11:09', lv: 24412.30 },
  { n: 12, hd: '22/04', ht: '11:24', hv: 24449.70, ld: '22/04', lt: '11:48', lv: 24390.55 },
  { n: 13, hd: '22/04', ht: '12:03', hv: 24436.35, ld: '22/04', lt: '12:36', lv: 24395.50 },
  { n: 14, hd: '22/04', ht: '12:45', hv: 24423.15, ld: '22/04', lt: '12:48', lv: 24403.55 },
  { n: 15, hd: '22/04', ht: '13:06', hv: 24437.70, ld: '22/04', lt: '13:12', lv: 24417.80 },
  { n: 16, hd: '22/04', ht: '13:15', hv: 24433.15, ld: '22/04', lt: '13:21', lv: 24385.45 },
  { n: 17, hd: '22/04', ht: '13:54', hv: 24442.25, ld: '22/04', lt: '13:54', lv: 24415.10 },
  { n: 18, hd: '22/04', ht: '14:00', hv: 24458.25, ld: '22/04', lt: '14:18', lv: 24390.70 },
  { n: 19, hd: '22/04', ht: '14:36', hv: 24430.00, ld: '22/04', lt: '14:48', lv: 24408.50 },
  { n: 20, hd: '22/04', ht: '14:54', hv: 24430.25, ld: '23/04', lt: '09:15', lv: 24134.80 },
  { n: 21, hd: '23/04', ht: '10:03', hv: 24310.20, ld: '23/04', lt: '10:15', lv: 24260.60 },
  { n: 22, hd: '23/04', ht: '10:18', hv: 24291.65, ld: '23/04', lt: '11:45', lv: 24172.85 },
  { n: 23, hd: '23/04', ht: '12:21', hv: 24231.50, ld: '23/04', lt: '12:36', lv: 24167.10 },
  { n: 24, hd: '23/04', ht: '12:45', hv: 24204.05, ld: '23/04', lt: '12:51', lv: 24186.50 },
  { n: 25, hd: '23/04', ht: '13:24', hv: 24281.10, ld: '23/04', lt: '13:39', lv: 24204.30 },
  { n: 26, hd: '23/04', ht: '13:57', hv: 24252.75, ld: '23/04', lt: '14:45', lv: 24157.95 },
  { n: 27, hd: '23/04', ht: '14:48', hv: 24194.05, ld: '23/04', lt: '14:51', lv: 24173.35 },
  { n: 28, hd: '23/04', ht: '15:00', hv: 24216.70, ld: '24/04', lt: '09:15', lv: 24100.25 },
  { n: 29, hd: '24/04', ht: '09:15', hv: 24206.00, ld: '24/04', lt: '09:54', lv: 23944.10 },
  { n: 30, hd: '24/04', ht: '10:06', hv: 24003.35, ld: '24/04', lt: '10:09', lv: 23977.35 },
  { n: 31, hd: '24/04', ht: '10:12', hv: 24000.90, ld: '24/04', lt: '11:00', lv: 23914.30 },
  { n: 32, hd: '24/04', ht: '11:06', hv: 23943.80, ld: '24/04', lt: '11:15', lv: 23903.25 },
  { n: 33, hd: '24/04', ht: '11:33', hv: 23949.30, ld: '24/04', lt: '11:54', lv: 23893.40 },
  { n: 34, hd: '24/04', ht: '12:18', hv: 23936.50, ld: '24/04', lt: '12:27', lv: 23878.80 },
  { n: 35, hd: '24/04', ht: '12:36', hv: 23910.70, ld: '24/04', lt: '12:42', lv: 23880.95 },
  { n: 36, hd: '24/04', ht: '12:57', hv: 23919.05, ld: '24/04', lt: '14:06', lv: 23813.65 },
  { n: 37, hd: '24/04', ht: '14:45', hv: 23930.50, ld: '24/04', lt: '15:03', lv: 23863.30 },
  { n: 38, hd: '27/04', ht: '09:57', hv: 24107.60, ld: '27/04', lt: '10:12', lv: 24061.70 },
  { n: 39, hd: '27/04', ht: '10:15', hv: 24103.15, ld: '27/04', lt: '10:33', lv: 24013.00 },
  { n: 40, hd: '27/04', ht: '10:54', hv: 24088.95, ld: '27/04', lt: '11:09', lv: 24026.85 },
];

// Build unified waves array (bearish HH→LL + bullish LL→HH)
function buildWaves() {
  const waves = [];
  RAW.forEach((w, i) => {
    const bearDelta = +(w.hv - w.lv).toFixed(2);
    waves.push({
      id: `${w.n}-bear`,
      n: w.n,
      date: w.hd,
      dir: "bear",
      hhTime: `${w.hd} ${w.ht}`,
      hhPrice: w.hv,
      llTime: `${w.ld} ${w.lt}`,
      llPrice: w.lv,
      delta: bearDelta,
      label: "HH→LL",
    });
    if (i < RAW.length - 1) {
      const next = RAW[i + 1];
      const bullDelta = +(next.hv - w.lv).toFixed(2);
      waves.push({
        id: `${w.n}-bull`,
        n: w.n + 0.5,
        date: w.ld,
        dir: "bull",
        hhTime: `${next.hd} ${next.ht}`,
        hhPrice: next.hv,
        llTime: `${w.ld} ${w.lt}`,
        llPrice: w.lv,
        delta: bullDelta,
        label: "LL→HH",
      });
    }
  });
  return waves;
}

const ALL_WAVES = buildWaves();
const MAX_DELTA = Math.max(...ALL_WAVES.map((w) => w.delta));

const DATES = [...new Set(RAW.flatMap((r) => [r.hd, r.ld]))].sort();

function fmt(n) {
  return Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function waveNumDisplay(n) {
  return Number.isInteger(n) ? String(n) : Math.floor(n) + "½";
}

// ── Sort columns ──────────────────────────────────────────────────────────────
const SORT_COLS = ["delta", "hhTime", "llTime"];

export default function ChartsReportPage() {
  const navigate = useNavigate();

  // ── Filter state ────────────────────────────────────────────────────────────
  const [fDate, setFDate] = useState("all");
  const [fDir, setFDir] = useState("all");
  const [fSize, setFSize] = useState("all");
  const [fQ, setFQ] = useState("");

  // ── Sort state ──────────────────────────────────────────────────────────────
  const [sortCol, setSortCol] = useState("delta");
  const [sortDir, setSortDir] = useState("asc"); // 'asc' | 'desc' | null

  function handleColSort(col) {
    if (sortCol === col) {
      // cycle: asc → desc → null(clear) → asc
      if (sortDir === "asc") setSortDir("desc");
      else if (sortDir === "desc") { setSortDir(null); setSortCol(null); }
      else { setSortDir("asc"); setSortCol(col); }
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  }

  function clearSort() {
    setSortCol(null);
    setSortDir(null);
  }

  // ── Filtered + sorted data ──────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let data = ALL_WAVES.filter((w) => {
      if (fDate !== "all" && w.date !== fDate) return false;
      if (fDir === "bull" && w.dir !== "bull") return false;
      if (fDir === "bear" && w.dir !== "bear") return false;
      if (fSize === "small" && w.delta >= 30) return false;
      if (fSize === "medium" && (w.delta < 30 || w.delta > 80)) return false;
      if (fSize === "large" && w.delta <= 80) return false;
      if (fQ && !String(Math.round(w.n)).includes(fQ.trim())) return false;
      return true;
    });

    if (sortCol && sortDir) {
      data = [...data].sort((a, b) => {
        let av = sortCol === "delta" ? a.delta : sortCol === "hhTime" ? a.hhTime : a.llTime;
        let bv = sortCol === "delta" ? b.delta : sortCol === "hhTime" ? b.hhTime : b.llTime;
        if (sortDir === "asc") return typeof av === "number" ? av - bv : av > bv ? 1 : -1;
        return typeof av === "number" ? bv - av : bv > av ? 1 : -1;
      });
    }

    return data;
  }, [fDate, fDir, fSize, fQ, sortCol, sortDir]);

  // ── Stats ───────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const allDeltas = ALL_WAVES.map((w) => w.delta);
    const bullWaves = ALL_WAVES.filter((w) => w.dir === "bull");
    const bearWaves = ALL_WAVES.filter((w) => w.dir === "bear");
    return {
      total: RAW.length,
      avg: (allDeltas.reduce((a, b) => a + b, 0) / allDeltas.length).toFixed(1),
      maxBull: Math.max(...bullWaves.map((w) => w.delta)).toFixed(2),
      maxBear: Math.max(...bearWaves.map((w) => w.delta)).toFixed(2),
    };
  }, []);

  // Sort icon helper
  function sortArrow(col) {
    if (sortCol !== col || !sortDir) return <span className="cr-sort-arrow inactive">↕</span>;
    return <span className="cr-sort-arrow active">{sortDir === "asc" ? "↑" : "↓"}</span>;
  }

  // Active sort label for the Δ button
  const sortLabel = !sortCol
    ? "Sort by wave Δ"
    : sortDir === "asc"
      ? "Δ Ascending"
      : "Δ Descending";

  // Group by date when not sorted by column
  const isSortedByDelta = sortCol === "delta" && sortDir;
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

        <div className="cr-topbar-title">
          <span className="cr-ticker">NSE:NIFTY50-INDEX</span>
          <span className="cr-ticker-sub">Unified Wave Table · HH / LL pivots</span>
        </div>

        <button className="cr-analyze-btn">
          Analyze ↗
        </button>
      </div>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div className="cr-body">

        {/* Stats row */}
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
            <div className="cr-stat-val cr-bear">-{stats.maxBear}</div>
          </div>
        </div>

        {/* Controls */}
        <div className="cr-controls">
          {/* Date filter */}
          <div className="cr-select-wrap">
            <select value={fDate} onChange={(e) => setFDate(e.target.value)} className="cr-select">
              <option value="all">All dates</option>
              {DATES.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>

          {/* Direction filter */}
          <div className="cr-select-wrap">
            <select value={fDir} onChange={(e) => setFDir(e.target.value)} className="cr-select">
              <option value="all">All directions</option>
              <option value="bull">Bullish only ▲</option>
              <option value="bear">Bearish only ▼</option>
            </select>
          </div>

          {/* Size filter */}
          <div className="cr-select-wrap">
            <select value={fSize} onChange={(e) => setFSize(e.target.value)} className="cr-select">
              <option value="all">All sizes</option>
              <option value="small">Small (&lt; 30)</option>
              <option value="medium">Medium (30–80)</option>
              <option value="large">Large (&gt; 80)</option>
            </select>
          </div>

          {/* Sort Δ toggle button with clear X */}
          <div className="cr-sort-group">
            <button
              className={`cr-sort-btn ${sortCol === "delta" && sortDir ? "active" : ""}`}
              onClick={() => handleColSort("delta")}
            >
              <span>{sortLabel}</span>
              <span className="cr-sort-icon">
                {sortCol === "delta" && sortDir ? (sortDir === "asc" ? "↑" : "↓") : "↕"}
              </span>
            </button>
            {sortCol && sortDir && (
              <button className="cr-clear-sort" onClick={clearSort} title="Clear sort">
                ✕
              </button>
            )}
          </div>

          {/* Wave search */}
          <div className="cr-search-wrap">
            <input
              type="text"
              value={fQ}
              onChange={(e) => setFQ(e.target.value)}
              placeholder="Wave #..."
              className="cr-search"
            />
            {fQ && (
              <button className="cr-search-clear" onClick={() => setFQ("")} title="Clear search">✕</button>
            )}
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
                  className={`cr-th-sortable ${sortCol === "hhTime" ? "cr-th-sorted" : ""}`}
                  onClick={() => handleColSort("hhTime")}
                >
                  HH Time {sortArrow("hhTime")}
                </th>
                <th className="cr-th">HH Price</th>
                <th
                  className={`cr-th-sortable ${sortCol === "llTime" ? "cr-th-sorted" : ""}`}
                  onClick={() => handleColSort("llTime")}
                >
                  LL Time {sortArrow("llTime")}
                </th>
                <th className="cr-th">LL Price</th>
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
                  <td colSpan={10} className="cr-no-data">No waves match the current filters.</td>
                </tr>
              ) : (
                filtered.map((w, idx) => {
                  const showDateSep = !isSortedByDelta && w.date !== lastDate;
                  if (showDateSep) lastDate = w.date;

                  const barW = Math.max(4, Math.round((w.delta / MAX_DELTA) * 100));
                  const isBull = w.dir === "bull";
                  const wNum = waveNumDisplay(w.n);

                  return (
                    <React.Fragment key={w.id}>
                      {showDateSep && (
                        <tr className="cr-date-sep">
                          <td colSpan={10}>— {w.date} —</td>
                        </tr>
                      )}
                      <tr className="cr-row">
                        {/* # rank */}
                        <td>
                          {isSortedByDelta ? (
                            <RankPill rank={idx + 1} />
                          ) : (
                            <span className="cr-w-num">{idx + 1}</span>
                          )}
                        </td>

                        {/* Wave */}
                        <td>
                          <span className="cr-w-num">{wNum}</span>
                          <br />
                          <span className="cr-w-label">{w.label}</span>
                        </td>

                        {/* Direction badge */}
                        <td>
                          {isBull ? (
                            <span className="cr-badge cr-badge-bull">▲ Bullish</span>
                          ) : (
                            <span className="cr-badge cr-badge-bear">▼ Bearish</span>
                          )}
                        </td>

                        {/* HH Time + Price combined */}
                        <td>
                          <span className="cr-time">{w.hhTime}</span>
                          <span className="cr-price">{fmt(w.hhPrice)}</span>
                        </td>

                        {/* HH Price standalone */}
                        <td>
                          <span className="cr-price">{fmt(w.hhPrice)}</span>
                        </td>

                        {/* LL Time + Price combined */}
                        <td>
                          <span className="cr-time">{w.llTime}</span>
                          <span className="cr-price">{fmt(w.llPrice)}</span>
                        </td>

                        {/* LL Price standalone */}
                        <td>
                          <span className="cr-price">{fmt(w.llPrice)}</span>
                        </td>

                        {/* Delta */}
                        <td>
                          <span className={`cr-delta ${isBull ? "cr-bull" : "cr-bear"}`}>
                            {isBull ? "+" : "−"}{w.delta.toFixed(2)}
                          </span>
                        </td>

                        {/* Strength bar */}
                        <td>
                          <div className="cr-bar-wrap">
                            <div className="cr-bar-bg">
                              <div
                                className="cr-bar-fill"
                                style={{
                                  width: `${barW}%`,
                                  background: isBull ? "#639922" : "#E24B4A",
                                }}
                              />
                            </div>
                            <span className="cr-bar-pct">{barW}%</span>
                          </div>
                        </td>

                        {/* Size badge */}
                        <td>
                          <SizeBadge delta={w.delta} isBull={isBull} />
                        </td>
                      </tr>
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function RankPill({ rank }) {
  const cls =
    rank === 1 ? "cr-rank cr-rank-1"
      : rank === 2 ? "cr-rank cr-rank-2"
        : rank === 3 ? "cr-rank cr-rank-3"
          : "cr-rank";
  return <span className={cls}>{rank}</span>;
}

function SizeBadge({ delta, isBull }) {
  if (delta < 30) return <span className="cr-badge cr-badge-sm">Small</span>;
  if (delta <= 80) return <span className="cr-badge cr-badge-med">Medium</span>;
  return isBull
    ? <span className="cr-badge cr-badge-lg-bull">Large</span>
    : <span className="cr-badge cr-badge-lg-bear">Large</span>;
}