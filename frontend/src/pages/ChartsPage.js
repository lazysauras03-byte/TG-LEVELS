// ChartsPage.js
// ─── Each panel is 100% independent (TradingView-style):
// ─────  Own navbar, own symbol, own resolution, own drawings, own indicators
// ─────  Nothing bleeds between panels
// ─── Layout: LAYOUT button only (no DUAL button)
// ─────  Single / 2 Side-by-Side / 2 Stacked / 3 Panels / 4 Panels
// ─── Draggable dividers in ALL multi-panel layouts
// ─────  col-resize handle between columns, row-resize handle between rows
// ─── ONE global TradingToolbar (fixed left) — shared across all panels.
// ─────  activePanel tracks which panel was last clicked/interacted with.
// ─────  Only the active panel accepts new drawing input.
// ─────  When link is ON, drawing broadcasts to all panels with same symbol.
// ─── Synced crosshair: when mouse moves on any panel, all panels with the
// ─────  SAME SYMBOL show the crosshair price as a dashed horizontal line.
// ─────────────────────────────────────────────────────────────────────────────
import React, {
  useState, useCallback, useEffect, useRef, useMemo, memo,
} from "react";
import { useNavigate, useLocation } from "react-router-dom";
import StatusBar from "../components/StatusBar";
import SymbolSearch from "../components/SymbolSearch";
import CandleChart from "../components/CandleChart";
import SignalTable from "../components/SignalTable";
import StatsPanel from "../components/StatsPanel";
import WaveSignalTable from "../components/WaveSignalTable";
import WaveStatsPanel from "../components/WaveStatsPanel";
import ConsolidationZoneTable from "../components/ConsolidationZoneTable";
import EmaFloatPanel from "../components/EmaFloatPanel";
import TradingToolbar from "../components/TradingToolbar";
import { DrawingProvider, usePanelLink, setAllLinked } from "../components/DrawingContext";
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

// ─── Layout definitions ────────────────────────────────────────────────────────
export const LAYOUTS = [
  { id: "1", label: "Single", cols: 1, rows: 1, panels: 1, icon: "1x1" },
  { id: "2h", label: "2 Side-by-Side", cols: 2, rows: 1, panels: 2, icon: "2h" },
  { id: "2v", label: "2 Stacked", cols: 1, rows: 2, panels: 2, icon: "2v" },
  { id: "3", label: "3 Panels", cols: 2, rows: 2, panels: 3, icon: "3" },
  { id: "4", label: "4 Panels", cols: 2, rows: 2, panels: 4, icon: "4" },
];

// ─── Layout Icon SVG ───────────────────────────────────────────────────────────
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

// ─── Layout Picker Dropdown (exported → used by StatusBar) ────────────────────
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
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", right: 0,
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
// ChartPanel — one fully independent chart panel (TradingView style).
// ═══════════════════════════════════════════════════════════════════════════════
const ChartPanel = memo(function ChartPanel({
  pfx,
  showSidebar,
  panelIdx,
  panelCount,
  layoutId,
  onLayoutChange,
  urlSymbol,
  urlResolution,
  urlWaveTarget,
  urlFibDrawing,
  urlSrLines,
  // Global toolbar state (from ChartsPage)
  selectedTool,
  setSelectedTool,
  drawColor,
  isActivePanel,
  onPanelActivate,
  panelActionsRef,
  setActivePanelHidden,
  panelLinkRef,
  setToolbarLinked,
  // ── Synced crosshair ──────────────────────────────────────────────────────
  // price+symbol broadcast by whichever panel the mouse is on
  syncedCrosshairPrice,   // number | null
  syncedCrosshairSymbol,  // string | null  — symbol that produced the price
  onSyncCrosshair,        // (price: number|null, symbol: string) => void
}) {
  // ── EACH PANEL has its own socket/data — fully independent ─────────────────
  const { chartData, connected, loading, error, refresh, tickStreamActive } = useSocket();

  // ── Symbol / resolution / mode — all namespaced by pfx ────────────────────
  const [symbol, setSymbol] = useState(() => urlSymbol || loadPref(pfx + "symbol", "NSE:NIFTY50-INDEX"));
  const [resolution, setResolution] = useState(() => urlResolution || loadPref(pfx + "resolution", 3));
  const [todayMode, setTodayMode] = useState(() => {
    if (urlSymbol || urlResolution) return false;
    return loadPref(pfx + "todayMode", true);
  });
  const [sidebarOpen, setSidebarOpen] = useState(() => loadPref(pfx + "sidebarOpen", true));
  const [activeTabs, setActiveTabs] = useState(() =>
    loadPref(pfx + "activeTabs", { bubble: "signals", waves: "signals", consolidation: "zones" })
  );

  // ── Drawing link — symbol-based sync, only active when panelCount > 1 ────
  const { linked, setLinked, sharedDrawings, setSharedDrawings, publishDrawings, setAbsorbShared } = usePanelLink(
    `panel_${panelIdx ?? 0}`,
    symbol
  );

  useEffect(() => { savePref(pfx + "symbol", symbol); }, [symbol]);           // eslint-disable-line
  useEffect(() => { savePref(pfx + "resolution", resolution); }, [resolution]); // eslint-disable-line
  useEffect(() => { savePref(pfx + "todayMode", todayMode); }, [todayMode]);    // eslint-disable-line
  useEffect(() => { savePref(pfx + "sidebarOpen", sidebarOpen); }, [sidebarOpen]); // eslint-disable-line
  useEffect(() => { savePref(pfx + "activeTabs", activeTabs); }, [activeTabs]); // eslint-disable-line

  // ── Drawings hidden — per panel ────────────────────────────────────────────
  const [drawingsHidden, setDrawingsHidden] = useState(false);
  const handleToggleHide = useCallback(() => setDrawingsHidden((v) => !v), []);
  const drawingOverlayExtRef = useRef(null);
  const handleTrashAll = useCallback(() => drawingOverlayExtRef.current?.clearAll(), []);

  // Register this panel's actions with the global toolbar when it becomes active
  useEffect(() => {
    if (!isActivePanel || !panelActionsRef) return;
    panelActionsRef.current = {
      toggleHide: handleToggleHide,
      trashAll: handleTrashAll,
      drawingsHidden,
    };
    if (setActivePanelHidden) setActivePanelHidden(drawingsHidden);
    // Register this panel's link state with the global toolbar
    if (panelLinkRef) {
      panelLinkRef.current = { linked, setLinked };
    }
    if (setToolbarLinked) setToolbarLinked(linked);
  }, [isActivePanel, drawingsHidden, linked, handleToggleHide, handleTrashAll, panelActionsRef, setActivePanelHidden, panelLinkRef, setToolbarLinked, setLinked]); // eslint-disable-line

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
  const consolidationOn = !!indicators.consolidation;
  const srZonesOn = !!indicators.srZones;
  const bubbleGap = typeof indicators.bubbleGap === "number" ? indicators.bubbleGap : 4;
  const anySidebarIndicator = bubbleOn || wavesOn || consolidationOn;

  const prevAnyRef = useRef(bubbleOn || wavesOn || consolidationOn);
  useEffect(() => {
    const anyNow = bubbleOn || wavesOn || consolidationOn;
    const anyBefore = prevAnyRef.current;
    if (!anyBefore && anyNow) setSidebarOpen(true);
    if (anyBefore && !anyNow) setSidebarOpen(false);
    prevAnyRef.current = anyNow;
  }, [bubbleOn, wavesOn, consolidationOn]);

  // ── Wave data ──────────────────────────────────────────────────────────────
  const [wavePivots, setWavePivots] = useState([]);
  const [waveSegments, setWaveSegments] = useState([]);
  const handleWaveData = useCallback((pivots, segments) => {
    setWavePivots(pivots);
    setWaveSegments(segments);
  }, []);

  // ── Consolidation zone data ────────────────────────────────────────────────
  const [consolidationZones, setConsolidationZones] = useState([]);
  const handleConsolidationData = useCallback((zones) => {
    setConsolidationZones(zones);
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
        resolution: urlFibDrawing.resolution ?? resolution,
      });
    }, 800);
  }, [candles.length, urlFibDrawing]); // eslint-disable-line

  // ── Symbol search modal ────────────────────────────────────────────────────
  const [searchOpen, setSearchOpen] = useState(false);

  // ── Crosshair ──────────────────────────────────────────────────────────────
  const [crosshairBar, setCrosshairBar] = useState(null);
  const handleCrosshairMove = useCallback((bar) => setCrosshairBar(bar), []);

  // ── Synced crosshair: this panel shows synced line only if same symbol ─────
  // Only pass the synced price down if the broadcasting panel has the same symbol.
  const matchesSyncedSymbol = syncedCrosshairSymbol === symbol;
  const thisPanelSyncedPrice = matchesSyncedSymbol ? syncedCrosshairPrice : null;

  // onSyncCrosshair wrapper: include this panel's symbol so ChartsPage can filter
  const handleSyncCrosshair = useCallback((price) => {
    if (onSyncCrosshair) onSyncCrosshair(price, symbol);
  }, [onSyncCrosshair, symbol]);

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

  const isPrimary = (panelIdx ?? 0) === 0;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="cp-panel">

      {/* StatusBar — each panel has its OWN statusbar, fully independent */}
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
          onOpenSearch={() => setSearchOpen(true)}
          todayMode={todayMode}
          onTodayToggle={handleTodayToggle}
          crosshairBar={crosshairBar}
          onSidebarToggle={handleSidebarToggle}
          tickStreamActive={tickStreamActive}
          dualMode={false}
          onDualToggle={undefined}
          layoutId={isPrimary ? layoutId : undefined}
          onLayoutChange={isPrimary ? onLayoutChange : undefined}
          indicators={indicators}
          onIndicatorChange={handleIndicatorChange}
        />
      </div>

      {/* SymbolSearch modal */}
      <SymbolSearch
        isOpen={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelect={(sym) => {
          handleSymbolChange(sym);
          handleRefresh(sym, resolution);
        }}
      />

      {/* Body: chart + optional sidebar */}
      <div className="cp-body">
        <div className="chart-area">
          {error && <div className="error-bar">⚠ {error}</div>}

          {/* Symbol overlay */}
          <button
            className="chart-symbol-overlay"
            onClick={() => setSearchOpen(true)}
            title="Click to change symbol"
          >
            <span className="chart-symbol-overlay-ticker">
              {symbol ? symbol.split(":").pop() : "—"}
            </span>
            <span className="chart-symbol-overlay-res">
              {resolution === 1 ? "1m" : resolution === 3 ? "3m" : resolution === 5 ? "5m" :
                resolution === 15 ? "15m" : resolution === 60 ? "1h" :
                  resolution === 1440 ? "1D" : resolution === 10080 ? "1W" : `${resolution}m`}
            </span>
          </button>

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
              showConsolidation={consolidationOn}
              bubbleGap={bubbleGap}
              onConsolidationData={handleConsolidationData}
              showSRZones={srZonesOn}
              onResetViewReady={handleResetViewReady}
              reloadToken={reloadToken}
              onIntentionalReloadAck={handleIntentionalReloadAck}
              activeResolution={chartDataResolution}
              symbol={symbol}
              waveTarget={urlWaveTarget}
              panelKey={pfx || "p1"}
              selectedTool={selectedTool}
              setSelectedTool={setSelectedTool}
              drawingsHidden={drawingsHidden}
              drawingOverlayExtRef={drawingOverlayExtRef}
              srLines={srLinesToDraw}
              onSRLinesDrawn={setSrLinesDrawn}
              drawColor={drawColor}
              linkColor={linked ? "linked" : null}
              sharedDrawings={sharedDrawings}
              onPublishDrawings={publishDrawings}
              setAbsorbShared={setAbsorbShared}
              onClearSharedDrawings={() => setSharedDrawings([])}
              isActivePanel={isActivePanel}
              onPanelActivate={onPanelActivate}
              syncedCrosshairPrice={thisPanelSyncedPrice}
              onSyncCrosshair={handleSyncCrosshair}
              onSilentRefresh={() => refresh(symbol, resolution)}
            />
          )}
        </div>

        {/* Sidebar */}
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

              {consolidationOn && (
                <div className="sidebar-section-wrap">
                  <SidebarSection
                    id="consolidation"
                    title="Consolidation"
                    color="#a259ff"
                    tab={activeTabs.consolidation ?? "zones"}
                    onTabChange={setTab}
                  >
                    {{
                      signalLabel: `Zones (${consolidationZones.length})`,
                      signals: <ConsolidationZoneTable zones={consolidationZones} todayMode={todayMode} />,
                      stats: <ConsolidationZoneTable zones={consolidationZones} todayMode={todayMode} />,
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
// useDraggableSplit — draggable divider returning [pct, ref, onMouseDown]
// ═══════════════════════════════════════════════════════════════════════════════
function useDraggableSplit(dir, storageKey, min = 15, max = 85) {
  const [pct, setPct] = useState(() => loadPref(storageKey, 50));
  const isDragging = useRef(false);
  const containerRef = useRef(null);

  const onMouseDown = useCallback((e) => {
    e.preventDefault();
    isDragging.current = true;
    document.body.style.cursor = dir === "col" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
  }, [dir]);

  useEffect(() => {
    function onMouseMove(e) {
      if (!isDragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      let raw;
      if (dir === "col") {
        raw = ((e.clientX - rect.left) / rect.width) * 100;
      } else {
        raw = ((e.clientY - rect.top) / rect.height) * 100;
      }
      const clamped = Math.min(max, Math.max(min, raw));
      setPct(clamped);
      savePref(storageKey, clamped);
      window.dispatchEvent(new Event("resize"));
    }
    function onMouseUp() {
      if (!isDragging.current) return;
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.dispatchEvent(new Event("resize"));
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [dir, storageKey, min, max]);

  return [pct, containerRef, onMouseDown];
}

// ─── Divider handle component ─────────────────────────────────────────────────
function Divider({ dir, onMouseDown }) {
  const isCol = dir === "col";
  return (
    <div
      className={isCol ? "panel-divider-col" : "panel-divider-row"}
      onMouseDown={onMouseDown}
      title="Drag to resize"
    >
      <div className={isCol ? "divider-grip-col" : "divider-grip-row"}>
        <span /><span /><span />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Layout renderers
// ═══════════════════════════════════════════════════════════════════════════════

function LayoutSingle({ urlParams, layoutId, onLayoutChange, toolbarProps }) {
  return (
    <div className="layout-single">
      <ChartPanel
        key="p0" pfx="" panelIdx={0} panelCount={1} showSidebar={true}
        layoutId={layoutId} onLayoutChange={onLayoutChange}
        urlSymbol={urlParams.symbol} urlResolution={urlParams.resolution}
        urlWaveTarget={urlParams.waveTarget} urlFibDrawing={urlParams.fibDrawing}
        urlSrLines={urlParams.srLines}
        isActivePanel={toolbarProps.activePanel === 0}
        onPanelActivate={() => toolbarProps.setActivePanel(0)}
        {...toolbarProps.shared}
      />
    </div>
  );
}

function Layout2H({ urlParams, layoutId, onLayoutChange, toolbarProps }) {
  const [colPct, containerRef, onDivMouseDown] = useDraggableSplit("col", "split2h_col");
  return (
    <div className="layout-2h" ref={containerRef}>
      <div className="layout-cell" style={{ width: `${colPct}%` }}>
        <ChartPanel key="p0" pfx="" panelIdx={0} panelCount={2} showSidebar={true}
          layoutId={layoutId} onLayoutChange={onLayoutChange}
          urlSymbol={urlParams.symbol} urlResolution={urlParams.resolution}
          urlWaveTarget={urlParams.waveTarget} urlFibDrawing={urlParams.fibDrawing}
          urlSrLines={urlParams.srLines}
          isActivePanel={toolbarProps.activePanel === 0}
          onPanelActivate={() => toolbarProps.setActivePanel(0)}
          {...toolbarProps.shared}
        />
      </div>
      <Divider dir="col" onMouseDown={onDivMouseDown} />
      <div className="layout-cell" style={{ flex: 1 }}>
        <ChartPanel key="p1" pfx="p2_" panelIdx={1} panelCount={2} showSidebar={false}
          layoutId={undefined} onLayoutChange={undefined}
          urlSymbol={null} urlResolution={null}
          urlWaveTarget={null} urlFibDrawing={null} urlSrLines={[]}
          isActivePanel={toolbarProps.activePanel === 1}
          onPanelActivate={() => toolbarProps.setActivePanel(1)}
          {...toolbarProps.shared}
        />
      </div>
    </div>
  );
}

function Layout2V({ urlParams, layoutId, onLayoutChange, toolbarProps }) {
  const [rowPct, containerRef, onDivMouseDown] = useDraggableSplit("row", "split2v_row");
  return (
    <div className="layout-2v" ref={containerRef}>
      <div className="layout-cell" style={{ height: `${rowPct}%` }}>
        <ChartPanel key="p0" pfx="" panelIdx={0} panelCount={2} showSidebar={true}
          layoutId={layoutId} onLayoutChange={onLayoutChange}
          urlSymbol={urlParams.symbol} urlResolution={urlParams.resolution}
          urlWaveTarget={urlParams.waveTarget} urlFibDrawing={urlParams.fibDrawing}
          urlSrLines={urlParams.srLines}
          isActivePanel={toolbarProps.activePanel === 0}
          onPanelActivate={() => toolbarProps.setActivePanel(0)}
          {...toolbarProps.shared}
        />
      </div>
      <Divider dir="row" onMouseDown={onDivMouseDown} />
      <div className="layout-cell" style={{ flex: 1 }}>
        <ChartPanel key="p1" pfx="p2_" panelIdx={1} panelCount={2} showSidebar={false}
          layoutId={undefined} onLayoutChange={undefined}
          urlSymbol={null} urlResolution={null}
          urlWaveTarget={null} urlFibDrawing={null} urlSrLines={[]}
          isActivePanel={toolbarProps.activePanel === 1}
          onPanelActivate={() => toolbarProps.setActivePanel(1)}
          {...toolbarProps.shared}
        />
      </div>
    </div>
  );
}

function Layout3({ urlParams, layoutId, onLayoutChange, toolbarProps }) {
  const [colPct, containerRef, onColMouseDown] = useDraggableSplit("col", "split3_col");
  const [rowPct, rightRef, onRowMouseDown] = useDraggableSplit("row", "split3_row");
  return (
    <div className="layout-3" ref={containerRef}>
      <div className="layout-cell" style={{ width: `${colPct}%` }}>
        <ChartPanel key="p0" pfx="" panelIdx={0} panelCount={3} showSidebar={true}
          layoutId={layoutId} onLayoutChange={onLayoutChange}
          urlSymbol={urlParams.symbol} urlResolution={urlParams.resolution}
          urlWaveTarget={urlParams.waveTarget} urlFibDrawing={urlParams.fibDrawing}
          urlSrLines={urlParams.srLines}
          isActivePanel={toolbarProps.activePanel === 0}
          onPanelActivate={() => toolbarProps.setActivePanel(0)}
          {...toolbarProps.shared}
        />
      </div>
      <Divider dir="col" onMouseDown={onColMouseDown} />
      <div className="layout-col" style={{ flex: 1 }} ref={rightRef}>
        <div className="layout-cell" style={{ height: `${rowPct}%` }}>
          <ChartPanel key="p1" pfx="p2_" panelIdx={1} panelCount={3} showSidebar={false}
            layoutId={undefined} onLayoutChange={undefined}
            urlSymbol={null} urlResolution={null}
            urlWaveTarget={null} urlFibDrawing={null} urlSrLines={[]}
            isActivePanel={toolbarProps.activePanel === 1}
            onPanelActivate={() => toolbarProps.setActivePanel(1)}
            {...toolbarProps.shared}
          />
        </div>
        <Divider dir="row" onMouseDown={onRowMouseDown} />
        <div className="layout-cell" style={{ flex: 1 }}>
          <ChartPanel key="p2" pfx="p3_" panelIdx={2} panelCount={3} showSidebar={false}
            layoutId={undefined} onLayoutChange={undefined}
            urlSymbol={null} urlResolution={null}
            urlWaveTarget={null} urlFibDrawing={null} urlSrLines={[]}
            isActivePanel={toolbarProps.activePanel === 2}
            onPanelActivate={() => toolbarProps.setActivePanel(2)}
            {...toolbarProps.shared}
          />
        </div>
      </div>
    </div>
  );
}

function Layout4({ urlParams, layoutId, onLayoutChange, toolbarProps }) {
  const [colPct, containerRef, onColMouseDown] = useDraggableSplit("col", "split4_col");
  const [rowPctL, leftRef, onRowLMouseDown] = useDraggableSplit("row", "split4_rowL");
  const [rowPctR, rightRef, onRowRMouseDown] = useDraggableSplit("row", "split4_rowR");
  return (
    <div className="layout-4" ref={containerRef}>
      <div className="layout-col" style={{ width: `${colPct}%` }} ref={leftRef}>
        <div className="layout-cell" style={{ height: `${rowPctL}%` }}>
          <ChartPanel key="p0" pfx="" panelIdx={0} panelCount={4} showSidebar={false}
            layoutId={layoutId} onLayoutChange={onLayoutChange}
            urlSymbol={urlParams.symbol} urlResolution={urlParams.resolution}
            urlWaveTarget={urlParams.waveTarget} urlFibDrawing={urlParams.fibDrawing}
            urlSrLines={urlParams.srLines}
            isActivePanel={toolbarProps.activePanel === 0}
            onPanelActivate={() => toolbarProps.setActivePanel(0)}
            {...toolbarProps.shared}
          />
        </div>
        <Divider dir="row" onMouseDown={onRowLMouseDown} />
        <div className="layout-cell" style={{ flex: 1 }}>
          <ChartPanel key="p2" pfx="p3_" panelIdx={2} panelCount={4} showSidebar={false}
            layoutId={undefined} onLayoutChange={undefined}
            urlSymbol={null} urlResolution={null}
            urlWaveTarget={null} urlFibDrawing={null} urlSrLines={[]}
            isActivePanel={toolbarProps.activePanel === 2}
            onPanelActivate={() => toolbarProps.setActivePanel(2)}
            {...toolbarProps.shared}
          />
        </div>
      </div>
      <Divider dir="col" onMouseDown={onColMouseDown} />
      <div className="layout-col" style={{ flex: 1 }} ref={rightRef}>
        <div className="layout-cell" style={{ height: `${rowPctR}%` }}>
          <ChartPanel key="p1" pfx="p2_" panelIdx={1} panelCount={4} showSidebar={false}
            layoutId={undefined} onLayoutChange={undefined}
            urlSymbol={null} urlResolution={null}
            urlWaveTarget={null} urlFibDrawing={null} urlSrLines={[]}
            isActivePanel={toolbarProps.activePanel === 1}
            onPanelActivate={() => toolbarProps.setActivePanel(1)}
            {...toolbarProps.shared}
          />
        </div>
        <Divider dir="row" onMouseDown={onRowRMouseDown} />
        <div className="layout-cell" style={{ flex: 1 }}>
          <ChartPanel key="p3" pfx="p4_" panelIdx={3} panelCount={4} showSidebar={false}
            layoutId={undefined} onLayoutChange={undefined}
            urlSymbol={null} urlResolution={null}
            urlWaveTarget={null} urlFibDrawing={null} urlSrLines={[]}
            isActivePanel={toolbarProps.activePanel === 3}
            onPanelActivate={() => toolbarProps.setActivePanel(3)}
            {...toolbarProps.shared}
          />
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ChartsPage — top-level: manages layoutId, URL params, AND global toolbar state.
// ═══════════════════════════════════════════════════════════════════════════════
export default function ChartsPage() {
  const location = useLocation();

  // ── Layout state ───────────────────────────────────────────────────────────
  const [layoutId, setLayoutId] = useState(() => loadPref("layoutId", "1"));
  const handleLayoutChange = useCallback((id) => {
    setLayoutId(id);
    savePref("layoutId", id);
    setActivePanel(0);
    setTimeout(() => window.dispatchEvent(new Event("resize")), 50);
    setTimeout(() => window.dispatchEvent(new Event("resize")), 200);
  }, []); // eslint-disable-line

  // ── Global toolbar state ───────────────────────────────────────────────────
  const [selectedTool, setSelectedTool] = useState("cursor");
  const [drawColor, setDrawColor] = useState("white");
  const [activePanel, setActivePanel] = useState(0);

  const panelActionsRef = useRef({ toggleHide: null, trashAll: null, drawingsHidden: false });
  const [activePanelHidden, setActivePanelHidden] = useState(false);

  const panelLinkRef = useRef({ linked: false, setLinked: null });
  const [toolbarLinked, setToolbarLinked] = useState(false);

  // ── Synced crosshair state — shared across all panels ─────────────────────
  // syncedCrosshairPrice: the price under the cursor on whichever panel is active
  // syncedCrosshairSymbol: the symbol of the panel broadcasting the price
  // Only panels with the SAME symbol will render the synced horizontal line.
  const [syncedCrosshairPrice, setSyncedCrosshairPrice] = useState(null);
  const [syncedCrosshairSymbol, setSyncedCrosshairSymbol] = useState(null);

  const handleSyncCrosshair = useCallback((price, symbol) => {
    setSyncedCrosshairPrice(price);
    setSyncedCrosshairSymbol(price != null ? symbol : null);
  }, []);

  // Esc key globally → cursor
  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") setSelectedTool("cursor"); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const panelCount = LAYOUTS.find((l) => l.id === layoutId)?.panels ?? 1;
  useEffect(() => {
    setActivePanel((p) => (p >= panelCount ? 0 : p));
  }, [panelCount]);

  // ── Toolbar props bundle — syncedCrosshair props included in shared ────────
  const toolbarProps = useMemo(() => ({
    activePanel,
    setActivePanel,
    shared: {
      selectedTool, setSelectedTool, drawColor,
      panelActionsRef, setActivePanelHidden,
      panelLinkRef, setToolbarLinked,
      syncedCrosshairPrice,
      syncedCrosshairSymbol,
      onSyncCrosshair: handleSyncCrosshair,
    },
  }), [activePanel, selectedTool, drawColor, syncedCrosshairPrice, syncedCrosshairSymbol, handleSyncCrosshair]); // eslint-disable-line

  // ── URL params — panel 0 only ──────────────────────────────────────────────
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

  // ── Render the right layout ────────────────────────────────────────────────
  function renderLayout() {
    const props = { urlParams, layoutId, onLayoutChange: handleLayoutChange, toolbarProps };
    switch (layoutId) {
      case "2h": return <Layout2H {...props} />;
      case "2v": return <Layout2V {...props} />;
      case "3": return <Layout3  {...props} />;
      case "4": return <Layout4  {...props} />;
      default: return <LayoutSingle {...props} />;
    }
  }

  return (
    <DrawingProvider>
      <div className="charts-page app-layout">
        {/* ONE global TradingToolbar — fixed on left, shared across all panels */}
        <TradingToolbar
          selectedTool={selectedTool}
          setSelectedTool={setSelectedTool}
          drawColor={drawColor}
          setDrawColor={setDrawColor}
          panelCount={panelCount}
          drawingsHidden={activePanelHidden}
          onToggleHide={() => panelActionsRef.current.toggleHide?.()}
          onTrashAll={() => panelActionsRef.current.trashAll?.()}
          linked={toolbarLinked}
          onLinkToggle={(val) => {
            setAllLinked(val);
          }}
        />
        {renderLayout()}
      </div>
    </DrawingProvider>
  );
}