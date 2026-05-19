// ChartsPage.js
// ─── Single chart by default. Dual-layout toggle is inside the StatusBar
// navbar (after Market Closed/Live). Each panel is fully independent.
// Divider is draggable left/right. Right panel has no sidebar.
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
//   pfx         : localStorage namespace "" | "left_" | "right_"
//   showSidebar : whether to render signals/stats sidebar
//   dualMode / onDualToggle : passed through to StatusBar for the DUAL button
//                             only the LEFT (or single) panel gets these
// ═══════════════════════════════════════════════════════════════════════════════
const ChartPanel = memo(function ChartPanel({
  pfx,
  showSidebar,
  dualMode,
  onDualToggle,
  urlSymbol,
  urlResolution,
  urlWaveTarget,
  urlFibDrawing,
  urlSrLines,
}) {
  const { chartData, connected, loading, error, refresh, tickStreamActive } = useSocket();

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

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="cp-panel">

      {/* StatusBar — receives dualMode + onDualToggle only on the primary panel */}
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

  // ── Dual-layout toggle — persisted ─────────────────────────────────────────
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

  // ── Draggable divider — % width of left panel (clamped 20–80) ──────────────
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

  // ── URL params — applied to the primary (single / left) panel only ──────────
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

  return (
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
        /* ── DUAL: two ChartPanel instances + draggable divider ─────────── */
        <div className="dual-container" ref={containerRef}>

          {/* Left panel — has DUAL button + sidebar */}
          <div className="dual-panel-wrap" style={{ width: `${splitPct}%` }}>
            <ChartPanel
              key="dual-left"
              pfx="left_"
              showSidebar={true}
              dualMode={dualMode}
              onDualToggle={handleDualToggle}
              urlSymbol={urlParams.symbol}
              urlResolution={urlParams.resolution}
              urlWaveTarget={urlParams.waveTarget}
              urlFibDrawing={urlParams.fibDrawing}
              urlSrLines={urlParams.srLines}
            />
          </div>

          {/* Draggable divider */}
          <div
            className="dual-divider"
            onMouseDown={onDividerMouseDown}
            title="Drag to resize panels"
          >
            <div className="dual-divider-grip">
              <span /><span /><span />
            </div>
          </div>

          {/* Right panel — compact dual layout, no sidebar, no DUAL button */}
          <div className="dual-panel-wrap" style={{ flex: 1 }}>
            <ChartPanel
              key="dual-right"
              pfx="right_"
              showSidebar={false}
              dualMode={true}
              onDualToggle={undefined}
              urlSymbol={null}
              urlResolution={null}
              urlWaveTarget={null}
              urlFibDrawing={null}
              urlSrLines={[]}
            />
          </div>

        </div>
      ) : (
        /* ── SINGLE: original layout — one ChartPanel, full sidebar ─────── */
        <div className="main-content">
          <ChartPanel
            key="single"
            pfx=""
            showSidebar={true}
            dualMode={dualMode}
            onDualToggle={handleDualToggle}
            urlSymbol={urlParams.symbol}
            urlResolution={urlParams.resolution}
            urlWaveTarget={urlParams.waveTarget}
            urlFibDrawing={urlParams.fibDrawing}
            urlSrLines={urlParams.srLines}
          />
        </div>
      )}
    </div>
  );
}