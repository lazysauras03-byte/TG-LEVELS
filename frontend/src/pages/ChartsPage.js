// ChartsPage.js
import React, { useState, useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import StatusBar from "../components/StatusBar";
import CandleChart from "../components/CandleChart";
import SignalTable from "../components/SignalTable";
import StatsPanel from "../components/StatsPanel";
import WaveSignalTable from "../components/WaveSignalTable";
import WaveStatsPanel from "../components/WaveStatsPanel";
import IndicatorPanel from "../components/IndicatorPanel";
import EmaFloatPanel from "../components/EmaFloatPanel";
import { useSocket } from "../hooks/useSocket";
import { buildDefaultIndicators } from "../indicators/indicatorRegistry";
import "./ChartsPage.css";

// ─── localStorage helpers ─────────────────────────────────────────────────────
function loadPref(key, fallback) {
  try {
    const v = localStorage.getItem("tgg_" + key);
    return v !== null ? JSON.parse(v) : fallback;
  } catch { return fallback; }
}
function savePref(key, value) {
  try { localStorage.setItem("tgg_" + key, JSON.stringify(value)); } catch { }
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function ChartsPage() {
  const navigate = useNavigate();
  const { chartData, connected, loading, error, refresh } = useSocket();

  const [symbol, setSymbol] = useState(() => loadPref("symbol", "NSE:NIFTY50-INDEX"));
  const [resolution, setResolution] = useState(() => loadPref("resolution", 3));
  const [todayMode, setTodayMode] = useState(() => loadPref("todayMode", true));
  const [sidebarOpen, setSidebarOpen] = useState(() => loadPref("sidebarOpen", true));

  // Per-indicator active tab: { bubble: "signals"|"stats", waves: "signals"|"stats" }
  const [activeTabs, setActiveTabs] = useState(() =>
    loadPref("activeTabs", { bubble: "signals", waves: "signals" })
  );

  useEffect(() => savePref("symbol", symbol), [symbol]);
  useEffect(() => savePref("resolution", resolution), [resolution]);
  useEffect(() => savePref("todayMode", todayMode), [todayMode]);
  useEffect(() => savePref("sidebarOpen", sidebarOpen), [sidebarOpen]);
  useEffect(() => savePref("activeTabs", activeTabs), [activeTabs]);

  // ── Indicator state ───────────────────────────────────────────────────────
  const [indicators, setIndicators] = useState(() =>
    loadPref("indicators", buildDefaultIndicators())
  );
  useEffect(() => savePref("indicators", indicators), [indicators]);

  function handleIndicatorChange(id, enabled) {
    setIndicators((prev) => ({ ...prev, [id]: enabled }));
  }

  const bubbleOn = indicators.bubble !== false;
  const wavesOn = !!indicators.waves;
  const anySidebarIndicator = bubbleOn || wavesOn;

  // When no sidebar indicator is on → collapse sidebar
  useEffect(() => {
    if (!anySidebarIndicator) setSidebarOpen(false);
  }, [anySidebarIndicator]);

  // ── Wave data from CandleChart ────────────────────────────────────────────
  const [wavePivots, setWavePivots] = useState([]);
  const [waveSegments, setWaveSegments] = useState([]);

  const handleWaveData = useCallback((pivots, segments) => {
    setWavePivots(pivots);
    setWaveSegments(segments);
  }, []);

  // Ref to CandleChart's resetView fn — called when user intentionally changes
  // symbol, timeframe, or hits Refresh, so the chart right-anchors to the new data.
  const chartResetRef = useRef(null);
  const handleResetViewReady = useCallback((fn) => { chartResetRef.current = fn; }, []);

  // Flag passed to CandleChart: true = next full data load should right-anchor,
  // false = background refresh should restore previous viewport.
  const [intentionalReload, setIntentionalReload] = useState(false);

  function handleRefresh(sym, res) {
    setIntentionalReload(true);
    refresh(sym ?? symbol, res ?? resolution);
  }
  function handleSymbolChange(sym) {
    setSymbol(sym);
    setIntentionalReload(true);
  }
  function handleResolutionChange(res) {
    setResolution(res);
    setIntentionalReload(true);
  }

  // Reset the flag once CandleChart has consumed it (after render)
  useEffect(() => {
    if (intentionalReload) setIntentionalReload(false);
  }, [intentionalReload]);

  // ── Initial data fetch ────────────────────────────────────────────────────
  const [didInitialFetch, setDidInitialFetch] = useState(false);
  useEffect(() => {
    if (!didInitialFetch) { setDidInitialFetch(true); refresh(symbol, resolution); }
  }, []); // eslint-disable-line

  // ── Crosshair ─────────────────────────────────────────────────────────────
  const [crosshairBar, setCrosshairBar] = useState(null);
  const handleCrosshairMove = useCallback((bar) => setCrosshairBar(bar), []);

  // ── Chart data ────────────────────────────────────────────────────────────
  const candles = chartData?.candles || [];
  const emaHighs = chartData?.emaHighs || [];
  const emaLows = chartData?.emaLows || [];
  const signals = chartData?.signals || [];
  const currentState = chartData?.currentState ?? 0;
  const bestPrice = chartData?.bestPrice;

  const showLoadingScreen = loading && candles.length === 0;

  // Displayed signal count for Bubble tab label
  const todayIST = new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
  const displayedSignals = todayMode
    ? signals.filter((s) => new Date(s.time).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }) === todayIST)
    : signals;
  const displayedWavePivots = todayMode
    ? wavePivots.filter((p) => new Date(p.time).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }) === todayIST)
    : wavePivots;

  function handleSidebarToggle() {
    if (!anySidebarIndicator) return;
    setSidebarOpen((p) => !p);
  }

  function setTab(indicator, tab) {
    setActiveTabs((prev) => ({ ...prev, [indicator]: tab }));
  }

  // ── Sidebar section component (inline, reused for Bubble + Waves) ─────────
  function SidebarSection({ id, title, color, tabSignalCount, tabWaveCount, children }) {
    const tab = activeTabs[id];
    const isBubble = id === "bubble";
    const sigCount = isBubble ? tabSignalCount : tabWaveCount;

    return (
      <div style={{ borderBottom: "1px solid var(--border)" }}>
        {/* Section header */}
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
        {/* Tabs */}
        <div className="tabs">
          <button
            className={`tab-btn ${tab === "signals" ? "active" : ""}`}
            onClick={() => setTab(id, "signals")}
          >
            {isBubble ? `Signals (${sigCount})` : `Pivots (${sigCount})`}
          </button>
          <button
            className={`tab-btn ${tab === "stats" ? "active" : ""}`}
            onClick={() => setTab(id, "stats")}
          >
            Stats
          </button>
        </div>
        <div className="tab-content">
          {children(tab)}
        </div>
      </div>
    );
  }

  return (
    <div className="charts-page app-layout">

      {/* ── Topbar ───────────────────────────────────────────────────────── */}
      <div className="charts-topbar">
        <button className="charts-home-btn" onClick={() => navigate("/")} title="Home">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
        </button>
        <div className="charts-status-bar-wrapper">
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
            onTodayToggle={() => setTodayMode((p) => !p)}
            crosshairBar={crosshairBar}
            onSidebarToggle={handleSidebarToggle}
            onReportClick={() => navigate("/charts-report")}
          />
        </div>
      </div>

      {/* ── Main content ─────────────────────────────────────────────────── */}
      <div className="main-content">

        {/* Chart area */}
        <div className="chart-area">
          {error && <div className="error-bar">⚠ {error}</div>}

          <div className="chart-indicator-float">
            <IndicatorPanel indicators={indicators} onChange={handleIndicatorChange} />
          </div>

          {/* EMA9 High/Low floating panel — bottom left */}
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
              intentionalReload={intentionalReload}
            />
          )}
        </div>

        {/* Sidebar — exists only when at least one sidebar indicator is ON */}
        {anySidebarIndicator && (
          <div className={`sidebar ${sidebarOpen ? "sidebar-open" : "sidebar-closed"}`}>
            <div className="sidebar-sections">

              {bubbleOn && (
                <div className="sidebar-section-wrap">
                  <SidebarSection
                    id="bubble"
                    title="Bubble"
                    color="var(--accent, #3d84ff)"
                    tabSignalCount={displayedSignals.length}
                    tabWaveCount={0}
                  >
                    {(tab) => tab === "signals" ? (
                      <SignalTable signals={signals} candles={candles} todayMode={todayMode} />
                    ) : (
                      <StatsPanel
                        signals={signals}
                        candles={candles}
                        currentState={currentState}
                        bestPrice={bestPrice}
                        todayMode={todayMode}
                      />
                    )}
                  </SidebarSection>
                </div>
              )}

              {wavesOn && (
                <div className="sidebar-section-wrap">
                  <SidebarSection
                    id="waves"
                    title="Waves"
                    color="#f5a623"
                    tabSignalCount={0}
                    tabWaveCount={displayedWavePivots.length}
                  >
                    {(tab) => tab === "signals" ? (
                      <WaveSignalTable wavePivots={wavePivots} todayMode={todayMode} />
                    ) : (
                      <WaveStatsPanel
                        wavePivots={wavePivots}
                        waveSegments={waveSegments}
                        todayMode={todayMode}
                      />
                    )}
                  </SidebarSection>
                </div>
              )}

            </div>
          </div>
        )}
      </div>
    </div>
  );
}