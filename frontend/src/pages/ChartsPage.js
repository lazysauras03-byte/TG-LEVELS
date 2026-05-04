import React, { useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import StatusBar from "../components/StatusBar";
import CandleChart from "../components/CandleChart";
import SignalTable from "../components/SignalTable";
import StatsPanel from "../components/StatsPanel";
import IndicatorPanel from "../components/IndicatorPanel";
import { useSocket } from "../hooks/useSocket";
import { buildDefaultIndicators } from "../indicators/indicatorRegistry";
import "./ChartsPage.css";

function loadPref(key, fallback) {
  try {
    const v = localStorage.getItem("tgg_" + key);
    return v !== null ? JSON.parse(v) : fallback;
  } catch { return fallback; }
}
function savePref(key, value) {
  try { localStorage.setItem("tgg_" + key, JSON.stringify(value)); } catch { }
}

export default function ChartsPage() {
  const navigate = useNavigate();
  const { chartData, connected, loading, error, refresh } = useSocket();

  const [symbol, setSymbol] = useState(() => loadPref("symbol", "NSE:NIFTY50-INDEX"));
  const [resolution, setResolution] = useState(() => loadPref("resolution", 3));
  const [activeTab, setActiveTab] = useState(() => loadPref("activeTab", "signals"));
  const [todayMode, setTodayMode] = useState(() => loadPref("todayMode", true));
  const [sidebarOpen, setSidebarOpen] = useState(() => loadPref("sidebarOpen", true));

  useEffect(() => savePref("symbol", symbol), [symbol]);
  useEffect(() => savePref("resolution", resolution), [resolution]);
  useEffect(() => savePref("activeTab", activeTab), [activeTab]);
  useEffect(() => savePref("todayMode", todayMode), [todayMode]);
  useEffect(() => savePref("sidebarOpen", sidebarOpen), [sidebarOpen]);

  // ── Indicator state ──────────────────────────────────────────────────────
  const [indicators, setIndicators] = useState(() =>
    loadPref("indicators", buildDefaultIndicators())
  );
  useEffect(() => savePref("indicators", indicators), [indicators]);

  function handleIndicatorChange(id, enabled) {
    setIndicators((prev) => ({ ...prev, [id]: enabled }));
  }

  // Derived: is the bubble indicator currently ON?
  const bubbleOn = indicators.bubble !== false;

  // When indicator is turned OFF → force-close sidebar so signals/stats disappear.
  // No auto-reopen when turned back ON — user controls that.
  useEffect(() => {
    if (!bubbleOn) {
      setSidebarOpen(false);
    }
  }, [bubbleOn]);

  // ── Initial fetch ────────────────────────────────────────────────────────
  const [didInitialFetch, setDidInitialFetch] = useState(false);
  useEffect(() => {
    if (!didInitialFetch) {
      setDidInitialFetch(true);
      refresh(symbol, resolution);
    }
  }, []); // eslint-disable-line

  const [crosshairBar, setCrosshairBar] = useState(null);
  const handleCrosshairMove = useCallback((bar) => setCrosshairBar(bar), []);

  const candles = chartData?.candles || [];
  const emaHighs = chartData?.emaHighs || [];
  const emaLows = chartData?.emaLows || [];
  const signals = chartData?.signals || [];
  const currentState = chartData?.currentState ?? 0;
  const bestPrice = chartData?.bestPrice;

  const showLoadingScreen = loading && candles.length === 0;

  const todayIST = new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
  const displayedSignals = todayMode
    ? signals.filter((s) =>
      new Date(s.time).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }) === todayIST
    )
    : signals;

  // Sidebar toggle blocked when indicator is OFF
  function handleSidebarToggle() {
    if (!bubbleOn) return;
    setSidebarOpen((p) => !p);
  }

  return (
    <div className="charts-page app-layout">

      {/* ── Topbar ──────────────────────────────────────────────────────── */}
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
            onRefresh={refresh}
            symbol={symbol}
            resolution={resolution}
            onSymbolChange={setSymbol}
            onResolutionChange={setResolution}
            todayMode={todayMode}
            onTodayToggle={() => setTodayMode((p) => !p)}
            crosshairBar={crosshairBar}
            onSidebarToggle={handleSidebarToggle}
          />
        </div>
      </div>

      {/* ── Main content ────────────────────────────────────────────────── */}
      <div className="main-content">

        <div className="chart-area">
          {error && <div className="error-bar">⚠ {error}</div>}

          {/* Floating Indicator Panel — top-left corner of the chart */}
          <div className="chart-indicator-float">
            <IndicatorPanel
              indicators={indicators}
              onChange={handleIndicatorChange}
            />
          </div>

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
            />
          )}
        </div>

        {/*
          Sidebar exists in DOM ONLY when indicator is ON.
          OFF → sidebar completely removed → no Signals tab, no Stats tab,
                no slide-in panel at all, chart fills full width.
          ON  → sidebar works normally with all tabs & timeframe filters.
        */}
        {bubbleOn && (
          <div className={`sidebar ${sidebarOpen ? "sidebar-open" : "sidebar-closed"}`}>
            <div className="tabs">
              <button
                className={`tab-btn ${activeTab === "signals" ? "active" : ""}`}
                onClick={() => setActiveTab("signals")}
              >
                Signals ({displayedSignals.length})
              </button>
              <button
                className={`tab-btn ${activeTab === "stats" ? "active" : ""}`}
                onClick={() => setActiveTab("stats")}
              >
                Stats
              </button>
            </div>
            <div className="tab-content">
              {activeTab === "signals" ? (
                <SignalTable
                  signals={signals}
                  candles={candles}
                  todayMode={todayMode}
                />
              ) : (
                <StatsPanel
                  signals={signals}
                  candles={candles}
                  currentState={currentState}
                  bestPrice={bestPrice}
                  todayMode={todayMode}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}