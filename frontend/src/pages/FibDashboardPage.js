// FibDashboardPage.js
// Fibonacci Wave · Entry Dashboard
//
// Uses updateWavesIndicatorPure() from WavesIndicator.js for motherwave detection.
// Uses BACKEND from config.js — same as the rest of the project.

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { updateWavesIndicatorPure } from "../indicators/WavesIndicator";
import { BACKEND } from "../config";
import SYMBOLS from "../symbols.json";
import "./FibDashboardPage.css";

// ── Timeframe definitions ────────────────────────────────────────────────────

const INTRADAY_TFS = [
  { label: "1Hour", value: 60 },
  { label: "15Min", value: 15 },
  { label: "5Min", value: 5 },
  { label: "3Min", value: 3 },
];

const ENTRY_TFS = [
  { label: "5Min", value: 5 },
  { label: "3Min", value: 3 },
  { label: "1Min", value: 1 },
];

const FIB_LEVELS = [
  { ratio: 0.000, badge: null },
  { ratio: 0.236, badge: null },
  { ratio: 0.382, badge: "Support" },
  { ratio: 0.500, badge: "Mid" },
  { ratio: 0.618, badge: "Golden" },
  { ratio: 0.786, badge: null },
  { ratio: 1.000, badge: null },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

const numFmt = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
function fmt(n) {
  return n == null ? "—" : numFmt.format(Number(n));
}

function computeFibLevels(segment) {
  if (!segment) return [];
  const { fromPrice, toPrice } = segment;
  const delta = toPrice - fromPrice;
  return FIB_LEVELS.map((f) => ({
    ratio: f.ratio,
    badge: f.badge,
    price: fromPrice + delta * f.ratio,
  }));
}

function getLastMotherwave(candles, emaHighs, emaLows) {
  const { segments } = updateWavesIndicatorPure(candles, emaHighs, emaLows);
  if (!segments.length) return null;
  // Use the largest wave by absolute delta — matches Reports page "Δ Descending" top row
  return segments.reduce((best, seg) => {
    const d = Math.abs(seg.toPrice - seg.fromPrice);
    const bd = Math.abs(best.toPrice - best.fromPrice);
    return d > bd ? seg : best;
  }, segments[0]);
}

function getBias(segment) {
  if (!segment) return "neutral";
  return segment.toSide === "high" ? "bull" : "bear";
}

function deriveEntries(motherwave, fibLevels, entryTFLabel) {
  if (!motherwave || !fibLevels.length) return [];
  const bias = getBias(motherwave);
  const isBear = bias === "bear";

  const lvl = (ratio) => fibLevels.find((f) => Math.abs(f.ratio - ratio) < 0.001)?.price;
  const goldenPrice = lvl(0.618);
  const midPrice = lvl(0.500);
  const supPrice = lvl(0.382);
  const startPrice = lvl(0.000);
  const endPrice = lvl(1.000);

  if (goldenPrice == null) return [];

  const entries = [];

  if (isBear) {
    if (goldenPrice != null && supPrice != null && startPrice != null) {
      const delta = Math.abs(goldenPrice - midPrice);
      const rr = delta > 0 ? (Math.abs(goldenPrice - supPrice) / delta).toFixed(1) : "—";
      entries.push({
        dir: "sell",
        label: `▼ SELL · ${entryTFLabel}`,
        entryPrice: goldenPrice,
        stopLoss: midPrice,
        target1: supPrice,
        target2: startPrice,
        rrText: rr,
        hint: `0.618 rejection · ${entryTFLabel} Fib confluence`,
      });
    }
    if (midPrice != null && supPrice != null) {
      const delta = Math.abs(midPrice - supPrice);
      const rr = delta > 0 ? (Math.abs(midPrice - supPrice) / delta).toFixed(1) : "—";
      entries.push({
        dir: "sell",
        label: `▼ SELL · ${entryTFLabel} (Mid)`,
        entryPrice: midPrice,
        stopLoss: goldenPrice,
        target1: supPrice,
        target2: startPrice,
        rrText: rr,
        hint: `Mid (0.500) rejection · bearish continuation`,
      });
    }
    if (supPrice != null && midPrice != null) {
      entries.push({
        dir: "buy",
        label: `▲ BUY · ${entryTFLabel} (CT)`,
        entryPrice: supPrice,
        stopLoss: startPrice,
        target1: midPrice,
        target2: goldenPrice,
        rrText: "1:2",
        hint: `Support (0.382) bounce · counter-trend scalp`,
      });
    }
  } else {
    if (supPrice != null && startPrice != null && goldenPrice != null) {
      entries.push({
        dir: "buy",
        label: `▲ BUY · ${entryTFLabel}`,
        entryPrice: supPrice,
        stopLoss: startPrice,
        target1: midPrice,
        target2: goldenPrice,
        rrText: "1:2",
        hint: `0.382 support bounce · ${entryTFLabel} Fib confluence`,
      });
    }
    if (goldenPrice != null && midPrice != null && endPrice != null) {
      entries.push({
        dir: "sell",
        label: `▼ SELL · ${entryTFLabel} (CT)`,
        entryPrice: goldenPrice,
        stopLoss: endPrice,
        target1: midPrice,
        target2: supPrice,
        rrText: "1:1.5",
        hint: `Golden (0.618) rejection · counter-trend scalp`,
      });
    }
  }

  return entries;
}

// ── Sub-components ───────────────────────────────────────────────────────────

function BiasPill({ bias }) {
  if (bias === "bear") return <span className="fdb-pill fdb-p-bear">▼ Down</span>;
  if (bias === "bull") return <span className="fdb-pill fdb-p-bull">▲ Up</span>;
  return <span className="fdb-pill fdb-p-neutral">— Neutral</span>;
}

function WaveCard({ segment, tfLabel, onClick }) {
  if (!segment) return <div className="fdb-no-wave">No mother wave detected</div>;
  const isBull = segment.toSide === "high";
  const delta = Math.abs(segment.toPrice - segment.fromPrice).toFixed(1);
  const waveNum = segment.waveNum != null ? segment.waveNum : null;
  return (
    <div
      className={`fdb-wave-card ${isBull ? "bull" : ""} ${onClick ? "fdb-wave-card-clickable" : ""}`}
      onClick={onClick}
      title={onClick ? "Click to open this wave on the chart" : undefined}
    >
      <div className="fdb-wave-card-header">
        <span className={`fdb-wave-dir ${isBull ? "fdb-bull-dir" : "fdb-bear-dir"}`}>
          {isBull ? "▲ Bull" : "▼ Bear"}
        </span>
        {waveNum != null && (
          <span className="fdb-wave-num">Wave {waveNum}</span>
        )}
        {onClick && <span className="fdb-wave-chart-hint">↗ Open chart</span>}
      </div>
      <div className="fdb-wave-range">
        {fmt(segment.fromPrice)} → {fmt(segment.toPrice)}
      </div>
      <div className="fdb-wave-pts">{tfLabel} &nbsp;·&nbsp; Δ {delta} pts</div>
    </div>
  );
}

function FibTable({ fibLevels }) {
  if (!fibLevels.length) return <div className="fdb-no-wave">No Fib data</div>;
  return (
    <table className="fdb-fib-tbl">
      <thead>
        <tr>
          <th>Level</th>
          <th></th>
          <th>Price</th>
        </tr>
      </thead>
      <tbody>
        {fibLevels.map((f) => (
          <tr key={f.ratio}>
            <td className="fdb-lvl-num">{f.ratio.toFixed(3)}</td>
            <td>
              {f.badge === "Support" && <span className="fdb-badge fdb-b-sup">Support</span>}
              {f.badge === "Mid" && <span className="fdb-badge fdb-b-mid">Mid</span>}
              {f.badge === "Golden" && <span className="fdb-badge fdb-b-gold">Golden</span>}
            </td>
            <td>{fmt(f.price)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function EntryBlock({ entry }) {
  const isSell = entry.dir === "sell";
  return (
    <div className="fdb-entry-block">
      <div className="fdb-entry-block-top">
        <span className={`fdb-entry-dir ${isSell ? "fdb-e-sell" : "fdb-e-buy"}`}>
          {entry.label}
        </span>
        <span className="fdb-rr-tag">R:R <span>{entry.rrText}</span></span>
      </div>
      <div className="fdb-e-row">
        <span className="fdb-lbl">Entry price</span>
        <span className={isSell ? "val-entry" : "val-entry-b"}>{fmt(entry.entryPrice)}</span>
      </div>
      <div className="fdb-e-row">
        <span className="fdb-lbl">Stop loss</span>
        <span className="val-sl">{fmt(entry.stopLoss)}</span>
      </div>
      <div className="fdb-e-row">
        <span className="fdb-lbl">Target 1</span>
        <span className="val-t1">{fmt(entry.target1)}</span>
      </div>
      <div className="fdb-e-row">
        <span className="fdb-lbl">Target 2</span>
        <span className="val-t2">{fmt(entry.target2)}</span>
      </div>
      <div className="fdb-e-hint">{entry.hint}</div>
    </div>
  );
}

// ── Data hook ────────────────────────────────────────────────────────────────

function useColData(symbol, tfValue) {
  const [state, setState] = useState({ status: "idle", segment: null });
  const abortRef = useRef(null);

  const fetchCol = useCallback(async (sym, res) => {
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setState((s) => ({ ...s, status: "loading" }));
    try {
      let data = null;
      // Try POST refresh first, fall back to GET
      try {
        const r = await fetch(
          `${BACKEND}/api/chart/refresh?symbol=${encodeURIComponent(sym)}&resolution=${res}`,
          { method: "POST", signal: ctrl.signal }
        );
        if (r.ok) data = await r.json();
      } catch (_) { /* fall through to GET */ }

      if (!data?.candles?.length) {
        const r2 = await fetch(
          `${BACKEND}/api/chart?symbol=${encodeURIComponent(sym)}&resolution=${res}`,
          { signal: ctrl.signal }
        );
        if (r2.ok) data = await r2.json();
      }

      if (ctrl.signal.aborted) return;

      if (data?.candles?.length) {
        const segment = getLastMotherwave(
          data.candles,
          data.emaHighs || [],
          data.emaLows || []
        );
        setState({ status: "done", segment, candles: data.candles, emaHighsData: data.emaHighs || [], emaLowsData: data.emaLows || [] });
      } else {
        setState({ status: "error", segment: null });
      }
    } catch (e) {
      if (e.name === "AbortError") return;
      setState({ status: "error", segment: null });
    }
  }, []);

  useEffect(() => {
    if (symbol && tfValue != null) fetchCol(symbol, tfValue);
    return () => { if (abortRef.current) abortRef.current.abort(); };
  }, [symbol, tfValue, fetchCol]);

  return { ...state, refetch: () => fetchCol(symbol, tfValue) };
}

// ── Symbol search ────────────────────────────────────────────────────────────

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
        const nm = s.name.toLowerCase();
        const colonIdx = s.symbol.indexOf(":");
        const ticker = (colonIdx >= 0 ? s.symbol.slice(colonIdx + 1) : s.symbol).toLowerCase();
        return nm.startsWith(q) || ticker.startsWith(q);
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
    <div style={{ position: "relative" }}>
      <input
        ref={inputRef}
        value={query}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => query && setShowDrop(suggestions.length > 0)}
        className="fdb-sym-select"
        placeholder="Search symbol…"
        autoComplete="off"
        spellCheck={false}
        style={{ width: 180 }}
      />
      {showDrop && (
        <div
          ref={dropRef}
          style={{
            position: "absolute", top: "100%", left: 0, zIndex: 200,
            background: "#1a1a34", border: "1px solid #3a3a6a", borderRadius: 4,
            minWidth: 220, maxHeight: 240, overflowY: "auto",
          }}
        >
          {suggestions.map((s, i) => (
            <div
              key={i}
              onMouseDown={() => handleSelect(s)}
              style={{
                padding: "6px 10px", cursor: "pointer", fontSize: 11,
                borderBottom: "1px solid #2a2a4a", display: "flex", gap: 8,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "#22224a"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              <span style={{ color: "#60aaff", fontWeight: 700 }}>{s.symbol}</span>
              <span style={{ color: "#5a5a8a" }}>
                {s.name.length > 30 ? s.name.slice(0, 30) + "…" : s.name}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Column 1 — High Timeframe ────────────────────────────────────────────────

function HtfColumn({ symbol }) {
  const [activeTF, setActiveTF] = useState(1440);
  const tfOptions = [
    { label: "1Week", value: 10080 },
    { label: "1Day", value: 1440 },
    { label: "1Hour", value: 60 },
  ];

  const { status, segment } = useColData(symbol, activeTF);
  const fibLevels = computeFibLevels(segment);
  const bias = getBias(segment);
  const waveLabel = activeTF >= 10080 ? "Weekly wave" : activeTF >= 1440 ? "Daily wave" : "1H wave";

  function handleWaveClick() {
    if (!segment) return;
    const params = new URLSearchParams({
      symbol,
      resolution: String(activeTF),
      waveFrom: String(segment.fromTime),
      waveTo: String(segment.toTime),
    });
    window.open(`/charts?${params.toString()}`, "_blank");
  }

  return (
    <div className="fdb-col">
      <div className="fdb-col-head">
        High time frame<span>Trend · Mother wave · Fib</span>
      </div>

      <div className="fdb-tf-row">
        {tfOptions.map((tf) => (
          <button
            key={tf.value}
            className={`fdb-tf ${activeTF === tf.value ? "on" : ""}`}
            onClick={() => setActiveTF(tf.value)}
          >
            {tf.label}
          </button>
        ))}
      </div>

      <div className="fdb-bias-line">
        <span>High timeframe bias</span>
        <BiasPill bias={status === "done" ? bias : "neutral"} />
      </div>

      <div className="fdb-sep" />

      <div className="fdb-col-body">
        <div className="fdb-sec-title">▸ Mother wave</div>
        {status === "loading" ? (
          <div className="fdb-state"><div className="fdb-spinner" /></div>
        ) : (
          <WaveCard segment={segment} tfLabel={waveLabel} onClick={segment ? handleWaveClick : undefined} />
        )}

        <div className="fdb-sep" />

        <div className="fdb-sec-title">▸ Fib retracement levels</div>
        {status === "loading" ? (
          <div className="fdb-state"><div className="fdb-spinner" /></div>
        ) : (
          <FibTable fibLevels={fibLevels} />
        )}
      </div>
    </div>
  );
}


// ── Support / Resistance computation ────────────────────────────────────────

function computeSRLevels(candles, emaHighs, emaLows) {
  if (!candles?.length) return null;
  const { pivots } = updateWavesIndicatorPure(candles, emaHighs, emaLows);
  if (!pivots.length) return null;

  const lastClose = candles[candles.length - 1].close;
  const tolerance = lastClose * 0.0018;

  function cluster(prices) {
    const sorted = [...prices].sort((a, b) => a - b);
    const clusters = [];
    for (const p of sorted) {
      const last = clusters[clusters.length - 1];
      if (last && Math.abs(p - last.avg) <= tolerance * 2) {
        last.prices.push(p);
        last.avg = last.prices.reduce((s, x) => s + x, 0) / last.prices.length;
        last.count = last.prices.length;
      } else {
        clusters.push({ avg: p, prices: [p], count: 1 });
      }
    }
    return clusters;
  }

  const highPivots = pivots.filter((p) => p.side === "high").map((p) => p.price);
  const lowPivots = pivots.filter((p) => p.side === "low").map((p) => p.price);

  const resClusters = cluster(highPivots).filter((c) => c.avg > lastClose).sort((a, b) => a.avg - b.avg);
  const supClusters = cluster(lowPivots).filter((c) => c.avg < lastClose).sort((a, b) => b.avg - a.avg);

  function strongest(clusters) {
    if (!clusters.length) return null;
    return clusters.reduce((best, c) => c.count >= best.count ? c : best, clusters[0]);
  }

  const copRes = cluster(lowPivots).filter((c) => c.avg > lastClose).sort((a, b) => a.avg - b.avg)[0] || null;
  const copSup = cluster(highPivots).filter((c) => c.avg < lastClose).sort((a, b) => b.avg - a.avg)[0] || null;

  return {
    r2: resClusters[1] || null,
    r1: resClusters[0] || null,
    current: lastClose,
    s1: supClusters[0] || null,
    s2: supClusters[1] || null,
    strongestRes: strongest(resClusters),
    strongestSup: strongest(supClusters),
    copRes,
    copSup,
  };
}

// ── SR Panel component ───────────────────────────────────────────────────────

function SRPanel({ sr, status }) {
  if (status === "loading") return <div className="fdb-state"><div className="fdb-spinner" /></div>;
  if (!sr) return <div className="fdb-no-wave">No pivot data available</div>;

  const { r2, r1, current, s1, s2, strongestRes, strongestSup, copRes, copSup } = sr;

  function LevelRow({ label, cluster, type, extra }) {
    if (!cluster) return null;
    const isStrongestRes = strongestRes && Math.abs(cluster.avg - strongestRes.avg) < 0.01;
    const isStrongestSup = strongestSup && Math.abs(cluster.avg - strongestSup.avg) < 0.01;
    const isStrongest = isStrongestRes || isStrongestSup;
    const isCopR = copRes && Math.abs(cluster.avg - copRes.avg) < 0.01;
    const isCopS = copSup && Math.abs(cluster.avg - copSup.avg) < 0.01;
    const isCoP = isCopR || isCopS;
    return (
      <div className={`sr-row sr-row-${type}`}>
        <div className="sr-label-wrap">
          <span className="sr-label">{label}</span>
          {isStrongest && <span className="sr-badge sr-strongest">&#128293; Strongest</span>}
          {isCoP && <span className="sr-badge sr-cop">&#x27F3; CoP</span>}
        </div>
        <div className="sr-right">
          <span className={`sr-price sr-price-${type}`}>{fmt(cluster.avg)}</span>
          <span className="sr-touches">{cluster.count}&times; touch{cluster.count !== 1 ? "es" : ""}</span>
          {extra && <span className="sr-extra">{extra}</span>}
        </div>
      </div>
    );
  }

  return (
    <div className="sr-panel">
      <LevelRow label="R2" cluster={r2} type="res" extra="2nd resistance" />
      <LevelRow label="R1" cluster={r1} type="res" extra="nearest high" />
      <div className="sr-row sr-row-current">
        <span className="sr-label sr-label-current">&#9654; Current</span>
        <span className="sr-price sr-price-current">{fmt(current)}</span>
      </div>
      <LevelRow label="S1" cluster={s1} type="sup" extra="nearest low" />
      <LevelRow label="S2" cluster={s2} type="sup" extra="2nd support" />
      {(copRes || copSup) && (
        <div className="sr-cop-note">
          {copRes && (
            <div className="sr-cop-row sr-cop-res">
              <span className="sr-cop-icon">&#x27F3;</span>
              <span>CoP Resistance &mdash; ex-support @ {fmt(copRes.avg)} (price fell below)</span>
            </div>
          )}
          {copSup && (
            <div className="sr-cop-row sr-cop-sup">
              <span className="sr-cop-icon">&#x27F3;</span>
              <span>CoP Support &mdash; ex-resistance @ {fmt(copSup.avg)} (price broke above)</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Column 2 — Intraday ──────────────────────────────────────────────────────

// ── Single-TF SR sub-panel ───────────────────────────────────────────────────

function SRSubPanel({ symbol, tfValue, tfLabel }) {
  const { status, segment, candles, emaHighsData, emaLowsData } = useColData(symbol, tfValue);
  const bias = getBias(segment);

  const sr = (status === "done" && candles?.length)
    ? computeSRLevels(candles, emaHighsData, emaLowsData)
    : null;

  return (
    <div className="sr-subpanel">
      <div className="sr-subpanel-head">
        <span className="sr-tf-label">{tfLabel}</span>
        <BiasPill bias={status === "done" ? bias : "neutral"} />

      </div>
      {status === "loading" ? (
        <div className="fdb-state" style={{ minHeight: 60 }}><div className="fdb-spinner" /></div>
      ) : (
        <SRPanel sr={sr} status={status} />
      )}
    </div>
  );
}

function IntradayColumn({ symbol }) {
  return (
    <div className="fdb-col">
      <div className="fdb-col-head">
        Intraday · Support &amp; Resistance<span>15Min pivot levels</span>
      </div>

      <div className="fdb-col-body fdb-sr-body">
        <SRSubPanel symbol={symbol} tfValue={15} tfLabel="15Min" />
      </div>
    </div>
  );
}

// ── Column 3 — Entry ─────────────────────────────────────────────────────────

function EntryColumn({ symbol }) {
  const [activeEntryTF, setActiveEntryTF] = useState(1);

  const { status, segment } = useColData(symbol, activeEntryTF);
  const fibLevels = computeFibLevels(segment);
  const bias = getBias(segment);
  const isBull = bias === "bull";
  const isBear = bias === "bear";
  const tfLabel = ENTRY_TFS.find((t) => t.value === activeEntryTF)?.label || `${activeEntryTF}Min`;
  const entries = deriveEntries(segment, fibLevels, tfLabel);
  const sellEntries = entries.filter((e) => e.dir === "sell");
  const buyEntries = entries.filter((e) => e.dir === "buy");

  return (
    <div className="fdb-col">
      <div className="fdb-col-head">
        Entry timeframe<span>Precise entry points</span>
      </div>

      <div className="fdb-tf-row">
        {ENTRY_TFS.map((tf) => (
          <button
            key={tf.value}
            className={`fdb-tf ${activeEntryTF === tf.value ? "on" : ""}`}
            onClick={() => setActiveEntryTF(tf.value)}
          >
            {tf.label}
          </button>
        ))}
      </div>

      <div className="fdb-align-row">
        <div className={`fdb-align-dot ${isBull ? "bull" : ""}`} />
        <span>Alignment</span>
        {status === "done" && (
          <span
            className={`fdb-pill ${isBear ? "fdb-p-bear" : isBull ? "fdb-p-bull" : "fdb-p-neutral"}`}
            style={{ fontSize: 9, padding: "1px 6px" }}
          >
            {isBear ? "● Bearish · Strong" : isBull ? "● Bullish · Strong" : "● Neutral"}
          </span>
        )}
      </div>

      <div className="fdb-sep" />

      <div className="fdb-col-body">
        {status === "loading" && (
          <div className="fdb-state"><div className="fdb-spinner" /></div>
        )}

        {status === "done" && (
          <>
            {sellEntries.map((entry, i) => (
              <React.Fragment key={`sell-${i}`}>
                <div className="fdb-sec-title" style={{ color: "#ff5555" }}>
                  ▼ SELL ENTRIES · {tfLabel}{i > 0 ? ` (${i + 1})` : ""}
                </div>
                <EntryBlock entry={entry} />
                {(i < sellEntries.length - 1 || buyEntries.length > 0) && <div className="fdb-sep" />}
              </React.Fragment>
            ))}

            {buyEntries.map((entry, i) => (
              <React.Fragment key={`buy-${i}`}>
                <div className="fdb-sec-title" style={{ color: "#55cc55" }}>
                  ▲ BUY ENTRIES · {tfLabel}{i > 0 ? ` (${i + 1})` : ""}
                </div>
                <EntryBlock entry={entry} />
                {i < buyEntries.length - 1 && <div className="fdb-sep" />}
              </React.Fragment>
            ))}

            {entries.length === 0 && (
              <div className="fdb-no-wave">No entry signals — waiting for motherwave</div>
            )}
          </>
        )}

        {status === "error" && (
          <div className="fdb-no-wave">
            ⚠ Could not load {tfLabel} data — check backend connection
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function FibDashboardPage() {
  const navigate = useNavigate();

  const [symbol, setSymbol] = useState(() => {
    try {
      const v = localStorage.getItem("tgg_symbol");
      return v ? JSON.parse(v) : "NSE:NIFTY50-INDEX";
    } catch { return "NSE:NIFTY50-INDEX"; }
  });

  function handleSymbolSelect(sym) {
    setSymbol(sym);
    localStorage.setItem("tgg_symbol", JSON.stringify(sym));
  }

  return (
    <div className="fdb-page">
      {/* Topbar */}
      <div className="fdb-topbar">
        <button className="fdb-back-btn" onClick={() => navigate("/HomePage.js")} title="Back to HomePage">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
        </button>

        <div className="fdb-topbar-left">
          <span className="fdb-symbol-label">{symbol}</span>
          <span className="fdb-title-label">Wave · Fib · Entry dashboard</span>
        </div>

        <div className="fdb-topbar-right">
          <SymbolSearch symbol={symbol} onSelect={handleSymbolSelect} />
        </div>
      </div>

      {/* Three-column grid */}
      <div className="fdb-dash">
        <HtfColumn symbol={symbol} key={`htf-${symbol}`} />
        <IntradayColumn symbol={symbol} key={`1h-${symbol}`} />
        <EntryColumn symbol={symbol} key={`ent-${symbol}`} />
      </div>
    </div>
  );
}