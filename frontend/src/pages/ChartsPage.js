// ChartsPage.js
// ─── Original logic 100% preserved:
// ─────  Single chart by default. Dual-layout toggle (DUAL button) inside StatusBar.
// ─────  Divider is draggable left/right (splitPct, containerRef, onDividerMouseDown).
// ─────  Right panel has no sidebar.
// ─── NEW additions on top (do not break anything above):
// ─────  LayoutPicker dropdown (1 / 2h / 2v / 3 / 4 panels) exported for StatusBar.
// ─────  LinkDotButton + DrawingContext for per-panel drawing sync.
// ─────  DrawingProvider wraps the whole page; each panel uses usePanelLink.
// ─────────────────────────────────────────────────────────────────────────────
import React, {
  useState, useCallback, useEffect, useRef, useMemo, memo,
} from "react";
import { useNavigate, useLocation } from "react-router-dom";
import StatusBar from "../components/StatusBar";
import CandleChart from "../components/CandleChart";
import SignalTable from "../components/SignalTable";
import StatsPanel from "../components/StatsPanel";
import WaveSignalTable from "../components/WaveSignalTable";
import WaveStatsPanel from "../components/WaveStatsPanel";
import IndicatorPanel from "../components/IndicatorPanel";
import EmaFloatPanel from "../components/EmaFloatPanel";
import TradingToolbar from "../components/TradingToolbar";
import { DrawingProvider, usePanelLink, LINK_COLORS } from "../components/DrawingContext";
import { useSocket } from "../hooks/useSocket";
import { buildDefaultIndicators } from "../indicators/indicatorRegistry";
import "./ChartsPage.css";

// ─── localStorage helpers ──────────────────────────────────────────────────────
function loadPref(key, fallback) {
  try {
    const v = localStorage.getItem("tgg_" + key);
    return v !== null ? JSON.parse(v) : fallback;
  } catch { return fallback; }
}
function savePref(key, value) {
  try { localStorage.setItem("tgg_" + key, JSON.stringify(value)); } catch { }
}

function toISTDate(tsMs) {
  return new Date(tsMs).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
}

// ─── NEW: Layout definitions ──────────────────────────────────────────────────
// These are used by LayoutPicker (exported) and StatusBar.
export const LAYOUTS = [
  { id: "1", label: "Single", cols: 1, rows: 1, panels: 1, icon: "1x1" },
  { id: "2h", label: "2 Side-by-Side", cols: 2, rows: 1, panels: 2, icon: "2h" },
  { id: "2v", label: "2 Stacked", cols: 1, rows: 2, panels: 2, icon: "2v" },
  { id: "3", label: "3 Panels", cols: 2, rows: 2, panels: 3, icon: "3" },
  { id: "4", label: "4 Panels", cols: 2, rows: 2, panels: 4, icon: "4" },
];

// ─── NEW: Layout Icon SVG ──────────────────────────────────────────────────────
function LayoutIcon({ icon, size = 18 }) {
  const s = size, p = 2, gap = 2;
  const inner = s - p * 2;
  const half = (inner - gap) / 2;
  switch (icon) {
    case "1x1":
      return <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} fill="none"><rect x={p} y={p} width={inner} height={inner} rx={1.5} stroke="currentColor" strokeWidth={1.5} /></svg>;
    case "2h":
      return <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} fill="none">
        <rect x={p} y={p} width={half} height={inner} rx={1.5} stroke="currentColor" strokeWidth={1.5} />
        <rect x={p + half + gap} y={p} width={half} height={inner} rx={1.5} stroke="currentColor" strokeWidth={1.5} />
      </svg>;
    case "2v":
      return <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} fill="none">
        <rect x={p} y={p} width={inner} height={half} rx={1.5} stroke="currentColor" strokeWidth={1.5} />
        <rect x={p} y={p + half + gap} width={inner} height={half} rx={1.5} stroke="currentColor" strokeWidth={1.5} />
      </svg>;
    case "3":
      return <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} fill="none">
        <rect x={p} y={p} width={half} height={inner} rx={1.5} stroke="currentColor" strokeWidth={1.5} />
        <rect x={p + half + gap} y={p} width={half} height={half} rx={1.5} stroke="currentColor" strokeWidth={1.5} />
        <rect x={p + half + gap} y={p + half + gap} width={half} height={half} rx={1.5} stroke="currentColor" strokeWidth={1.5} />
      </svg>;
    case "4":
      return <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} fill="none">
        <rect x={p} y={p} width={half} height={half} rx={1.5} stroke="currentColor" strokeWidth={1.5} />
        <rect x={p + half + gap} y={p} width={half} height={half} rx={1.5} stroke="currentColor" strokeWidth={1.5} />
        <rect x={p} y={p + half + gap} width={half} height={half} rx={1.5} stroke="currentColor" strokeWidth={1.5} />
        <rect x={p + half + gap} y={p + half + gap} width={half} height={half} rx={1.5} stroke="currentColor" strokeWidth={1.5} />
      </svg>;
    default: return null;
  }
}

// ─── NEW: Layout Picker Dropdown (exported → used by StatusBar) ───────────────
export function LayoutPicker({ currentLayout, onSelect }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const current = LAYOUTS.find((l) => l.id === currentLayout) || LAYOUTS[0];

  return (
    <div ref={ref} style={{ position: "relative", flexShrink: 0 }}>
      <button
        onClick={() => setOpen((o) => !o)}
        title="Change layout"
        style={{
          display: "flex", alignItems: "center", gap: 5,
          background: open ? "var(--accent-dim)" : "var(--bg3)",
          border: `1px solid ${open ? "var(--accent)" : "var(--border2)"}`,
          borderRadius: 5,
          color: open ? "var(--accent)" : "var(--text2)",
          fontFamily: "var(--font-mono)",
          fontSize: 11, fontWeight: 700,
          padding: "3px 10px",
          cursor: "pointer",
          letterSpacing: "0.04em",
          flexShrink: 0,
          transition: "background 0.15s, color 0.15s, border-color 0.15s",
        }}
      >
        <LayoutIcon icon={current.icon} size={15} />
        <span>LAYOUT</span>
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0,
          background: "var(--bg3)", border: "1px solid var(--border2)",
          borderRadius: 8, zIndex: 9999, padding: 10,
          boxShadow: "0 8px 32px var(--shadow)", minWidth: 210,
        }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", color: "var(--text3)", textTransform: "uppercase", marginBottom: 8 }}>
            Select Layout
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {LAYOUTS.map((layout) => {
              const active = layout.id === currentLayout;
              return (
                <button
                  key={layout.id}
                  onClick={() => { onSelect(layout.id); setOpen(false); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 10,
                    background: active ? "var(--accent-dim)" : "transparent",
                    border: `1px solid ${active ? "var(--accent)" : "transparent"}`,
                    borderRadius: 5,
                    color: active ? "var(--accent)" : "var(--text2)",
                    padding: "6px 10px", cursor: "pointer", textAlign: "left",
                    fontFamily: "var(--font-mono)", fontSize: 11, width: "100%",
                    fontWeight: active ? 700 : 400,
                    transition: "background 0.12s, color 0.12s",
                  }}
                  onMouseEnter={(e) => { if (!active) { e.currentTarget.style.background = "var(--bg2)"; e.currentTarget.style.color = "var(--text)"; } }}
                  onMouseLeave={(e) => { if (!active) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text2)"; } }}
                >
                  <span style={{ flexShrink: 0, color: active ? "var(--accent)" : "var(--text3)" }}>
                    <LayoutIcon icon={layout.icon} size={17} />
                  </span>
                  <span>{layout.label}</span>
                  {active && (
                    <svg style={{ marginLeft: "auto", flexShrink: 0 }} width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path d="M1.5 5l2.5 2.5L8.5 2" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── NEW: Link Dot Button (exported → used by StatusBar) ──────────────────────
export function LinkDotButton({ linkColor, onSetLink }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const active = LINK_COLORS.find((c) => c.id === linkColor);

  return (
    <div ref={ref} style={{ position: "relative", flexShrink: 0 }}>
      <button
        onClick={() => setOpen((o) => !o)}
        title={linkColor ? `Linked (${linkColor}) — click to change` : "Link drawings to other panels"}
        style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          width: 28, height: 28,
          background: "var(--bg3)",
          border: `1.5px solid ${active ? active.hex : "var(--border2)"}`,
          borderRadius: "50%",
          cursor: "pointer",
          transition: "border-color 0.15s",
          padding: 0,
          flexShrink: 0,
        }}
      >
        <span style={{
          display: "block", width: 9, height: 9, borderRadius: "50%",
          background: active ? active.hex : "var(--text3)",
          flexShrink: 0,
        }} />
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", right: 0,
          background: "var(--bg3)", border: "1px solid var(--border2)",
          borderRadius: 8, zIndex: 9999, padding: 8,
          boxShadow: "0 8px 32px var(--shadow)", minWidth: 150,
        }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", color: "var(--text3)", textTransform: "uppercase", marginBottom: 6 }}>
            Link Drawings
          </div>
          <button
            onClick={() => { onSetLink(null); setOpen(false); }}
            style={{
              display: "flex", alignItems: "center", gap: 8, width: "100%",
              background: linkColor == null ? "var(--bg2)" : "transparent",
              border: "none", borderRadius: 4, padding: "5px 8px",
              color: "var(--text2)", cursor: "pointer", fontSize: 11, fontFamily: "var(--font-mono)",
              fontWeight: linkColor == null ? 700 : 400,
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--text3)", display: "block", flexShrink: 0 }} />
            Unlinked
          </button>
          {LINK_COLORS.map((c) => (
            <button
              key={c.id}
              onClick={() => { onSetLink(c.id); setOpen(false); }}
              style={{
                display: "flex", alignItems: "center", gap: 8, width: "100%",
                background: linkColor === c.id ? c.dim : "transparent",
                border: "none", borderRadius: 4, padding: "5px 8px",
                color: linkColor === c.id ? c.hex : "var(--text2)",
                cursor: "pointer", fontSize: 11, fontFamily: "var(--font-mono)",
                fontWeight: linkColor === c.id ? 700 : 400,
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: c.hex, display: "block", flexShrink: 0 }} />
              {c.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── SidebarSection — defined OUTSIDE so it never remounts ────────────────────
const SidebarSection = memo(function SidebarSection({ id, title, color, tab, onTabChange, children }) {
  return (
    <div style={{ borderBottom: "1px solid var(--border)" }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 6,
        padding: "8px 12px 4px",
        borderBottom: "1px solid var(--border)",
      }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, display: "inline-block" }} />
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", color: "var(--text3)", textTransform: "uppercase" }}>
          {title}
        </span>
      </div>
      <div className="tabs">
        <button className={`tab-btn ${tab === "signals" ? "active" : ""}`} onClick={() => onTabChange(id, "signals")}>
          {children.signalLabel}
        </button>
        <button className={`tab-btn ${tab === "stats" ? "active" : ""}`} onClick={() => onTabChange(id, "stats")}>
          Stats
        </button>
      </div>
      <div className="tab-content">
        {tab === "signals" ? children.signals : children.stats}
      </div>
    </div>
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// ChartPanel — one fully independent chart panel.
//   pfx            : localStorage namespace "" | "left_" | "right_"
//   showSidebar    : whether to render signals/stats sidebar
//   dualMode       : ORIGINAL — passed through to StatusBar for the DUAL button
//   onDualToggle   : ORIGINAL — only the LEFT (or single) panel gets this
//   panelIdx       : NEW — 0-based index; panel 0 is primary (gets Layout picker)
//   onLayoutChange : NEW — called when Layout picker changes layout
//   linkColor/onSetLink: NEW — per-panel link dot for drawing sync
// ═══════════════════════════════════════════════════════════════════════════════
const ChartPanel = memo(function ChartPanel({
  pfx,
  showSidebar,
  // ── ORIGINAL props ────────────────────────────────────────────────────────
  dualMode,
  onDualToggle,
  // ── NEW props ─────────────────────────────────────────────────────────────
  panelIdx,
  layoutId,
  onLayoutChange,
  // ── URL props (original) ──────────────────────────────────────────────────
  urlSymbol,
  urlResolution,
  urlWaveTarget,
  urlFibDrawing,
  urlSrLines,
}) {
  const { chartData, connected, loading, error, refresh, tickStreamActive } = useSocket();

  // ── NEW: Drawing link ──────────────────────────────────────────────────────
  const { linkColor, setLinkColor, sharedDrawings, publishDrawings } = usePanelLink(`panel_${panelIdx ?? 0}`);

  // ── Symbol / resolution / mode ─────────────────────────────────────────────
  const [symbol, setSymbol] = useState(() => urlSymbol || loadPref(pfx + "symbol", "NSE:NIFTY50-INDEX"));
  const [resolution, setResolution] = useState(() => urlResolution || loadPref(pfx + "resolution", 3));
  const [todayMode, setTodayMode] = useState(() => {
    if (urlSymbol || urlResolution) return false;
    return loadPref(pfx + "todayMode", true);
  });
  const [sidebarOpen, setSidebarOpen] = useState(() => loadPref(pfx + "sidebarOpen", true));
  const [activeTabs, setActiveTabs] = useState(() =>
    loadPref(pfx + "activeTabs", { bubble: "signals", waves: "signals" })
  );

  useEffect(() => { savePref(pfx + "symbol", symbol); }, [symbol]);      // eslint-disable-line
  useEffect(() => { savePref(pfx + "resolution", resolution); }, [resolution]);  // eslint-disable-line
  useEffect(() => { savePref(pfx + "todayMode", todayMode); }, [todayMode]);   // eslint-disable-line
  useEffect(() => { savePref(pfx + "sidebarOpen", sidebarOpen); }, [sidebarOpen]); // eslint-disable-line
  useEffect(() => { savePref(pfx + "activeTabs", activeTabs); }, [activeTabs]);  // eslint-disable-line

  // ── Drawing / tool state ───────────────────────────────────────────────────
  const [selectedTool, setSelectedTool] = useState("cursor");
  const [drawColor, setDrawColor] = useState("white");
  const [drawingsHidden, setDrawingsHidden] = useState(false);
  const handleToggleHide = useCallback(() => setDrawingsHidden((v) => !v), []);
  const drawingOverlayExtRef = useRef(null);
  const handleTrashAll = useCallback(() => drawingOverlayExtRef.current?.clearAll(), []);

  // ── SR Lines ───────────────────────────────────────────────────────────────
  const [srLinesToDraw, setSrLinesToDraw] = useState(() => urlSrLines || []);
  const [srLinesDrawn, setSrLinesDrawn] = useState(false);
  const handleDrawSRLines = useCallback(() => {
    if (srLinesDrawn) {
      setSrLinesToDraw([]);
    } else if (urlSrLines?.length) {
      setSrLinesToDraw(urlSrLines);
    }
  }, [srLinesDrawn, urlSrLines]); // eslint-disable-line

  // Escape → cursor
  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") setSelectedTool("cursor"); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── Indicators — namespaced per panel ─────────────────────────────────────
  const [indicators, setIndicators] = useState(() => {
    const defaults = loadPref(pfx + "indicators", buildDefaultIndicators());
    if (urlWaveTarget) return { ...defaults, waves: true };
    return defaults;
  });
  useEffect(() => { savePref(pfx + "indicators", indicators); }, [indicators]); // eslint-disable-line

  const handleIndicatorChange = useCallback((id, enabled) => {
    setIndicators((prev) => ({ ...prev, [id]: enabled }));
  }, []);

  const bubbleOn = indicators.bubble !== false;
  const wavesOn = !!indicators.waves;
  const anySidebarIndicator = bubbleOn || wavesOn;

  const prevAnyRef = useRef(bubbleOn || wavesOn);
  useEffect(() => {
    const anyNow = bubbleOn || wavesOn;
    const anyBefore = prevAnyRef.current;
    if (!anyBefore && anyNow) setSidebarOpen(true);
    if (anyBefore && !anyNow) setSidebarOpen(false);
    prevAnyRef.current = anyNow;
  }, [bubbleOn, wavesOn]);

  // ── Wave data ──────────────────────────────────────────────────────────────
  const [wavePivots, setWavePivots] = useState([]);
  const [waveSegments, setWaveSegments] = useState([]);
  const handleWaveData = useCallback((pivots, segments) => {
    setWavePivots(pivots);
    setWaveSegments(segments);
  }, []);

  const chartResetRef = useRef(null);
  const handleResetViewReady = useCallback((fn) => { chartResetRef.current = fn; }, []);

  const [reloadToken, setReloadToken] = useState(0);
  const handleIntentionalReloadAck = useCallback(() => setReloadToken(0), []);
  const triggerIntentionalReload = useCallback(() => setReloadToken((t) => t + 1), []);

  // ── Refresh / symbol / resolution handlers ─────────────────────────────────
  const handleRefresh = useCallback((sym, res) => {
    triggerIntentionalReload();
    refresh(sym ?? symbol, res ?? resolution);
  }, [refresh, symbol, resolution, triggerIntentionalReload]); // eslint-disable-line

  const handleSymbolChange = useCallback((sym) => setSymbol(sym), []);
  const handleResolutionChange = useCallback((res) => {
    setResolution(res);
    triggerIntentionalReload();
  }, [triggerIntentionalReload]);

  // ── Initial fetch ──────────────────────────────────────────────────────────
  const didInitialFetch = useRef(false);
  useEffect(() => {
    if (!didInitialFetch.current) {
      didInitialFetch.current = true;
      triggerIntentionalReload();
      refresh(symbol, resolution);
    }
  }, []); // eslint-disable-line

  // ── Fib injection ──────────────────────────────────────────────────────────
  const fibInjectedRef = useRef(false);
  const candles = chartData?.candles || [];
  useEffect(() => {
    if (!urlFibDrawing || fibInjectedRef.current) return;
    if (!candles.length) return;
    if (!drawingOverlayExtRef.current?.addFibDrawing) return;
    fibInjectedRef.current = true;
    setTimeout(() => {
      drawingOverlayExtRef.current?.addFibDrawing({
        p1Price: urlFibDrawing.p1Price,
        p1Time: urlFibDrawing.p1Time ?? (urlWaveTarget?.toMs ? Math.round(urlWaveTarget.toMs / 1000) : null),
        p2Price: urlFibDrawing.p2Price,
        p2Time: urlFibDrawing.p2Time ?? (urlWaveTarget?.fromMs ? Math.round(urlWaveTarget.fromMs / 1000) : null),
      });
    }, 800);
  }, [candles.length, urlFibDrawing]); // eslint-disable-line

  // ── Crosshair ──────────────────────────────────────────────────────────────
  const [crosshairBar, setCrosshairBar] = useState(null);
  const handleCrosshairMove = useCallback((bar) => setCrosshairBar(bar), []);

  // ── Derived chart data ─────────────────────────────────────────────────────
  const emaHighs = chartData?.emaHighs || [];
  const emaLows = chartData?.emaLows || [];
  const signalsRaw = chartData?.signals || [];
  const signals = useMemo(() => signalsRaw, [signalsRaw.map((s) => `${s.type}:${s.time}`).join("|")]); // eslint-disable-line
  const currentState = chartData?.currentState ?? 0;
  const bestPrice = chartData?.bestPrice;
  const chartDataResolution = chartData?.resolution ?? resolution;
  const showLoadingScreen = loading && candles.length === 0;

  const todayIST = useMemo(() => new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }), []);

  const displayedSignals = useMemo(() => {
    if (!todayMode) return signals;
    return signals.filter((s) => toISTDate(s.time) === todayIST);
  }, [signals, todayMode, todayIST]);

  const displayedWavePivots = useMemo(() => {
    if (!todayMode) return wavePivots;
    return wavePivots.filter((p) => toISTDate(p.time) === todayIST);
  }, [wavePivots, todayMode, todayIST]);

  const handleSidebarToggle = useCallback(() => {
    if (!anySidebarIndicator) return;
    setSidebarOpen((p) => !p);
  }, [anySidebarIndicator]);

  const setTab = useCallback((indicator, tab) => {
    setActiveTabs((prev) => ({ ...prev, [indicator]: tab }));
  }, []);

  const handleTodayToggle = useCallback(() => setTodayMode((p) => !p), []);

  // NEW: is this the primary (panel 0)?
  const isPrimary = (panelIdx ?? 0) === 0;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="cp-panel">

      {/* StatusBar — receives dualMode + onDualToggle only on the primary panel */}
      {/* NEW: also receives layoutId/onLayoutChange and linkColor/onSetLink */}
      <div className="cp-statusbar">
        <StatusBar
          connected={connected}
          loading={loading}
          chartData={chartData}
          onRefresh={handleRefresh}
          symbol={symbol}
          resolution={resolution}
          onSymbolChange={handleSymbolChange}
          onResolutionChange={handleResolutionChange}
          todayMode={todayMode}
          onTodayToggle={handleTodayToggle}
          crosshairBar={crosshairBar}
          onSidebarToggle={handleSidebarToggle}
          tickStreamActive={tickStreamActive}
          dualMode={dualMode}
          onDualToggle={onDualToggle}
          layoutId={isPrimary ? layoutId : undefined}
          onLayoutChange={isPrimary ? onLayoutChange : undefined}
          linkColor={linkColor}
          onSetLink={setLinkColor}
        />
      </div>

      {/* Body: toolbar + chart + optional sidebar */}
      <div className="cp-body">
        <TradingToolbar
          selectedTool={selectedTool}
          setSelectedTool={setSelectedTool}
          drawingsHidden={drawingsHidden}
          onToggleHide={handleToggleHide}
          onTrashAll={handleTrashAll}
          srLines={srLinesToDraw}
          onDrawSRLines={handleDrawSRLines}
          srLinesDrawn={srLinesDrawn}
          drawColor={drawColor}
          setDrawColor={setDrawColor}
        />

        <div className="chart-area">
          {error && <div className="error-bar">⚠ {error}</div>}

          <div className="chart-indicator-float">
            <IndicatorPanel indicators={indicators} onChange={handleIndicatorChange} />
          </div>

          {candles.length > 0 && (
            <EmaFloatPanel
              emaHighs={emaHighs}
              emaLows={emaLows}
              candles={candles}
              crosshairBar={crosshairBar}
            />
          )}

          {showLoadingScreen ? (
            <div className="loading-screen">
              <div className="loading-spinner" />
              <div>Loading chart data…</div>
            </div>
          ) : candles.length === 0 ? (
            <div className="loading-screen">
              <div className="no-data-msg">
                <div className="no-data-icon">📊</div>
                <div className="no-data-title">No Data Yet</div>
                <div className="no-data-sub">
                  Run <code>npm run generate</code> in the backend terminal,<br />
                  then click Refresh above.
                </div>
              </div>
            </div>
          ) : (
            <CandleChart
              candles={candles}
              emaHighs={emaHighs}
              emaLows={emaLows}
              signals={signals}
              currentState={currentState}
              todayMode={todayMode}
              onCrosshairMove={handleCrosshairMove}
              showBubble={bubbleOn}
              showWaves={wavesOn}
              onWaveData={handleWaveData}
              onResetViewReady={handleResetViewReady}
              reloadToken={reloadToken}
              onIntentionalReloadAck={handleIntentionalReloadAck}
              activeResolution={chartDataResolution}
              symbol={symbol}
              waveTarget={urlWaveTarget}
              selectedTool={selectedTool}
              setSelectedTool={setSelectedTool}
              drawingsHidden={drawingsHidden}
              drawingOverlayExtRef={drawingOverlayExtRef}
              srLines={srLinesToDraw}
              onSRLinesDrawn={setSrLinesDrawn}
              drawColor={drawColor}
              linkColor={linkColor}
              sharedDrawings={sharedDrawings}
              onPublishDrawings={publishDrawings}
            />
          )}
        </div>

        {/* Sidebar — only where showSidebar=true */}
        {showSidebar && anySidebarIndicator && (
          <div className={`sidebar ${sidebarOpen ? "sidebar-open" : "sidebar-closed"}`}>
            <div className="sidebar-sections">

              {bubbleOn && (
                <div className="sidebar-section-wrap">
                  <SidebarSection
                    id="bubble"
                    title="Bubble"
                    color="var(--accent, #3d84ff)"
                    tab={activeTabs.bubble}
                    onTabChange={setTab}
                  >
                    {{
                      signalLabel: `Signals (${displayedSignals.length})`,
                      signals: <SignalTable signals={signals} candles={candles} todayMode={todayMode} />,
                      stats: <StatsPanel signals={signals} candles={candles} currentState={currentState} bestPrice={bestPrice} todayMode={todayMode} />,
                    }}
                  </SidebarSection>
                </div>
              )}

              {wavesOn && (
                <div className="sidebar-section-wrap">
                  <SidebarSection
                    id="waves"
                    title="Waves"
                    color="#f5a623"
                    tab={activeTabs.waves}
                    onTabChange={setTab}
                  >
                    {{
                      signalLabel: `Pivots (${displayedWavePivots.length})`,
                      signals: <WaveSignalTable wavePivots={wavePivots} todayMode={todayMode} />,
                      stats: <WaveStatsPanel wavePivots={wavePivots} waveSegments={waveSegments} todayMode={todayMode} />,
                    }}
                  </SidebarSection>
                </div>
              )}

            </div>
          </div>
        )}
      </div>
    </div>
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// ChartsPage — orchestrates single vs dual mode
// ═══════════════════════════════════════════════════════════════════════════════
export default function ChartsPage() {
  const navigate = useNavigate();
  const location = useLocation();

  // ── ORIGINAL: Dual-layout toggle — persisted ───────────────────────────────
  const [dualMode, setDualMode] = useState(() => loadPref("dualMode", false));
  const handleDualToggle = useCallback(() => {
    setDualMode((v) => {
      savePref("dualMode", !v);
      return !v;
    });
    // After React paints the new layout, tell charts to re-measure
    setTimeout(() => window.dispatchEvent(new Event("resize")), 50);
    setTimeout(() => window.dispatchEvent(new Event("resize")), 200);
  }, []);

  // ── ORIGINAL: Draggable divider — % width of left panel (clamped 20–80) ────
  const [splitPct, setSplitPct] = useState(() => loadPref("splitPct", 50));
  const isDragging = useRef(false);
  const containerRef = useRef(null);

  const onDividerMouseDown = useCallback((e) => {
    e.preventDefault();
    isDragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    function onMouseMove(e) {
      if (!isDragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const raw = ((e.clientX - rect.left) / rect.width) * 100;
      const clamped = Math.min(80, Math.max(20, raw));
      setSplitPct(clamped);
      savePref("splitPct", clamped);
      // Tell every ResizeObserver / lightweight-charts instance to re-measure
      window.dispatchEvent(new Event("resize"));
    }
    function onMouseUp() {
      if (!isDragging.current) return;
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      // Final resize flush after drag ends
      window.dispatchEvent(new Event("resize"));
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  // ── NEW: Layout picker state (persisted; DUAL button still works alongside) ─
  // layoutId is only used when dualMode is false and layout !== "1".
  // When dualMode is true, the DUAL divider takes over exactly as before.
  const [layoutId, setLayoutId] = useState(() => loadPref("layoutId", "1"));
  const handleLayoutChange = useCallback((id) => {
    setLayoutId(id);
    savePref("layoutId", id);
    // If user picks "2h" from LayoutPicker and dualMode is already on,
    // turn dualMode off so the grid takes over instead.
    if (id !== "1") {
      setDualMode(false);
      savePref("dualMode", false);
    }
    setTimeout(() => window.dispatchEvent(new Event("resize")), 50);
    setTimeout(() => window.dispatchEvent(new Event("resize")), 200);
  }, []);

  // ── ORIGINAL: URL params — applied to the primary (single / left) panel ────
  const urlParams = useMemo(() => {
    const p = new URLSearchParams(location.search);
    const waveFrom = p.get("waveFrom");
    const waveTo = p.get("waveTo");
    const waveTarget = (waveFrom && waveTo)
      ? { fromMs: Number(waveFrom), toMs: Number(waveTo) }
      : null;
    const symbol = p.get("symbol") || null;
    const resolution = p.get("resolution") ? Number(p.get("resolution")) : null;
    let fibDrawing = null;
    try {
      const raw = p.get("fibDrawing");
      if (raw) fibDrawing = JSON.parse(decodeURIComponent(raw));
    } catch { }
    let srLines = [];
    try {
      const raw = p.get("srLines");
      if (raw) srLines = JSON.parse(decodeURIComponent(raw));
    } catch { }
    return { waveTarget, symbol, resolution, fibDrawing, srLines };
  }, []); // eslint-disable-line

  // ── NEW: compute grid for multi-panel layouts (only used when !dualMode) ────
  function getGridStyle(id) {
    switch (id) {
      case "2h": return { gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr" };
      case "2v": return { gridTemplateColumns: "1fr", gridTemplateRows: "1fr 1fr" };
      case "3": return { gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr" };
      case "4": return { gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr" };
      default: return { gridTemplateColumns: "1fr", gridTemplateRows: "1fr" };
    }
  }
  function getPanelGridStyle(id, idx) {
    if (id === "3" && idx === 0) return { gridRow: "1 / 3" };
    return {};
  }
  const PANEL_PREFIXES = ["", "p2_", "p3_", "p4_"];
  const layout = LAYOUTS.find((l) => l.id === layoutId) || LAYOUTS[0];

  return (
    // NEW: DrawingProvider wraps everything so panels can share drawings
    <DrawingProvider>
      <div className="charts-page app-layout">

        {/* ══ Topbar — original: home btn only. StatusBar lives inside ChartPanel. ══ */}
        <div className="charts-topbar">
          <button className="charts-home-btn" onClick={() => navigate("/")} title="Home">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
          </button>
          {/* StatusBar fills the rest — rendered inside ChartPanel below */}
          <div className="charts-status-bar-wrapper" />
        </div>

        {/* ══ Content ══════════════════════════════════════════════════════════ */}
        {dualMode ? (
          /* ── ORIGINAL DUAL: two ChartPanel instances + draggable divider ─── */
          <div className="dual-container" ref={containerRef}>

            {/* Left panel — has DUAL button + sidebar */}
            <div className="dual-panel-wrap" style={{ width: `${splitPct}%` }}>
              <ChartPanel
                key="dual-left"
                pfx="left_"
                panelIdx={0}
                showSidebar={true}
                dualMode={dualMode}
                onDualToggle={handleDualToggle}
                layoutId={layoutId}
                onLayoutChange={handleLayoutChange}
                urlSymbol={urlParams.symbol}
                urlResolution={urlParams.resolution}
                urlWaveTarget={urlParams.waveTarget}
                urlFibDrawing={urlParams.fibDrawing}
                urlSrLines={urlParams.srLines}
              />
            </div>

            {/* Draggable divider — ORIGINAL, pixel-perfect */}
            <div
              className="dual-divider"
              onMouseDown={onDividerMouseDown}
              title="Drag to resize panels"
            >
              <div className="dual-divider-grip">
                <span /><span /><span />
              </div>
            </div>

            {/* Right panel — compact dual layout, has own sidebar, no DUAL button */}
            <div className="dual-panel-wrap" style={{ flex: 1 }}>
              <ChartPanel
                key="dual-right"
                pfx="right_"
                panelIdx={1}
                showSidebar={true}
                dualMode={true}
                onDualToggle={undefined}
                layoutId={undefined}
                onLayoutChange={undefined}
                urlSymbol={null}
                urlResolution={null}
                urlWaveTarget={null}
                urlFibDrawing={null}
                urlSrLines={[]}
              />
            </div>

          </div>
        ) : layout.panels === 1 ? (
          /* ── ORIGINAL SINGLE: one ChartPanel, full sidebar ─────────────── */
          <div className="main-content">
            <ChartPanel
              key="single"
              pfx=""
              panelIdx={0}
              showSidebar={true}
              dualMode={dualMode}
              onDualToggle={handleDualToggle}
              layoutId={layoutId}
              onLayoutChange={handleLayoutChange}
              urlSymbol={urlParams.symbol}
              urlResolution={urlParams.resolution}
              urlWaveTarget={urlParams.waveTarget}
              urlFibDrawing={urlParams.fibDrawing}
              urlSrLines={urlParams.srLines}
            />
          </div>
        ) : (
          /* ── NEW MULTI-PANEL GRID (2h / 2v / 3 / 4 layouts) ──────────────
             Only active when dualMode=false AND layoutId != "1".
             The DUAL button still turns on dualMode normally.          ─── */
          <div
            className="panels-grid"
            style={{
              display: "grid",
              flex: 1,
              minHeight: 0,
              ...getGridStyle(layoutId),
            }}
          >
            {Array.from({ length: layout.panels }, (_, i) => (
              <div
                key={`panel-${i}`}
                className="panel-cell"
                style={{
                  display: "flex", flexDirection: "column",
                  minWidth: 0, minHeight: 0, overflow: "hidden",
                  borderRight: "1px solid var(--border)",
                  borderBottom: "1px solid var(--border)",
                  ...getPanelGridStyle(layoutId, i),
                }}
              >
                <ChartPanel
                  pfx={PANEL_PREFIXES[i] || `p${i + 1}_`}
                  panelIdx={i}
                  showSidebar={i === 0}
                  dualMode={false}
                  onDualToggle={i === 0 ? handleDualToggle : undefined}
                  layoutId={i === 0 ? layoutId : undefined}
                  onLayoutChange={i === 0 ? handleLayoutChange : undefined}
                  urlSymbol={i === 0 ? urlParams.symbol : null}
                  urlResolution={i === 0 ? urlParams.resolution : null}
                  urlWaveTarget={i === 0 ? urlParams.waveTarget : null}
                  urlFibDrawing={i === 0 ? urlParams.fibDrawing : null}
                  urlSrLines={i === 0 ? urlParams.srLines : []}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </DrawingProvider>
  );
}