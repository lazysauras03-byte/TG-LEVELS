// ChartsPage.js
import React, { useState, useCallback, useEffect, useRef, useMemo, memo } from "react";
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

// IST date string helper — reused without allocation each call
function toISTDate(tsMs) {
  return new Date(tsMs).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
}

// ─── SidebarSection — defined OUTSIDE ChartsPage so it never remounts ─────────
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

// ─── Component ────────────────────────────────────────────────────────────────
export default function ChartsPage() {
  const navigate = useNavigate();
  const { chartData, connected, loading, error, refresh } = useSocket();

  const [symbol, setSymbol] = useState(() => loadPref("symbol", "NSE:NIFTY50-INDEX"));
  const [resolution, setResolution] = useState(() => loadPref("resolution", 3));
  const [todayMode, setTodayMode] = useState(() => loadPref("todayMode", true));
  const [sidebarOpen, setSidebarOpen] = useState(() => loadPref("sidebarOpen", true));
  const [activeTabs, setActiveTabs] = useState(() =>
    loadPref("activeTabs", { bubble: "signals", waves: "signals" })
  );

  // Batch pref saves with a single effect watching all prefs at once
  useEffect(() => { savePref("symbol", symbol); }, [symbol]);
  useEffect(() => { savePref("resolution", resolution); }, [resolution]);
  useEffect(() => { savePref("todayMode", todayMode); }, [todayMode]);
  useEffect(() => { savePref("sidebarOpen", sidebarOpen); }, [sidebarOpen]);
  useEffect(() => { savePref("activeTabs", activeTabs); }, [activeTabs]);

  // ── Indicator state ───────────────────────────────────────────────────────
  const [indicators, setIndicators] = useState(() =>
    loadPref("indicators", buildDefaultIndicators())
  );
  useEffect(() => { savePref("indicators", indicators); }, [indicators]);

  const handleIndicatorChange = useCallback((id, enabled) => {
    setIndicators((prev) => ({ ...prev, [id]: enabled }));
  }, []);

  const bubbleOn = indicators.bubble !== false;
  const wavesOn = !!indicators.waves;
  const anySidebarIndicator = bubbleOn || wavesOn;

  // ── Sidebar auto-open/close driven solely by indicator toggles ───────────
  // Open when any indicator turns ON; close when all turn OFF.
  // Today toggle and other state changes never touch sidebarOpen.
  const prevAnyRef = useRef(bubbleOn || wavesOn);
  useEffect(() => {
    const anyNow = bubbleOn || wavesOn;
    const anyBefore = prevAnyRef.current;
    if (!anyBefore && anyNow) setSidebarOpen(true);   // at least one just turned on
    if (anyBefore && !anyNow) setSidebarOpen(false);  // last one just turned off
    prevAnyRef.current = anyNow;
  }, [bubbleOn, wavesOn]);

  // ── Wave data from CandleChart ────────────────────────────────────────────
  const [wavePivots, setWavePivots] = useState([]);
  const [waveSegments, setWaveSegments] = useState([]);

  const handleWaveData = useCallback((pivots, segments) => {
    setWavePivots(pivots);
    setWaveSegments(segments);
  }, []);

  const chartResetRef = useRef(null);
  const handleResetViewReady = useCallback((fn) => { chartResetRef.current = fn; }, []);

  const [intentionalReload, setIntentionalReload] = useState(false);

  const handleRefresh = useCallback((sym, res) => {
    setIntentionalReload(true);
    refresh(sym ?? symbol, res ?? resolution);
  }, [refresh, symbol, resolution]);

  const handleSymbolChange = useCallback((sym) => {
    setSymbol(sym);
    setIntentionalReload(true);
  }, []);

  const handleResolutionChange = useCallback((res) => {
    setResolution(res);
    setIntentionalReload(true);
  }, []);

  useEffect(() => {
    if (intentionalReload) setIntentionalReload(false);
  }, [intentionalReload]);

  // ── Initial data fetch ────────────────────────────────────────────────────
  const didInitialFetch = useRef(false);
  useEffect(() => {
    if (!didInitialFetch.current) { didInitialFetch.current = true; refresh(symbol, resolution); }
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

  // Memoized today IST string — only recomputed when date changes
  const todayIST = useMemo(() => new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }), []);

  // Memoized filtered signals/pivots — only recomputed when deps change
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

  const handleReportClick = useCallback(() => navigate("/charts-report"), [navigate]);
  const handleTodayToggle = useCallback(() => setTodayMode((p) => !p), []);

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
            onTodayToggle={handleTodayToggle}
            crosshairBar={crosshairBar}
            onSidebarToggle={handleSidebarToggle}
            onReportClick={handleReportClick}
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

        {/* Sidebar */}
        {anySidebarIndicator && (
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
}